// src/controllers/inboundEmailController.ts
import { Request, Response } from 'express';
import { Resend } from 'resend';
import { RFPService } from '../services/rfpService';
import { VendorService } from '../services/vendorService';
import { prismaClient } from '../lib/prisma';

const rfpService = new RFPService();
const vendorService = new VendorService();
const resend = new Resend(process.env.RESEND_API_KEY!);

/**
 * POST /api/webhooks/inbound-email
 * Webhook endpoint for Resend inbound emails
 */
export const handleInboundEmail = async (req: Request, res: Response) => {
  try {
    console.log('\n========== INBOUND EMAIL WEBHOOK RECEIVED ==========');
    
    const webhookPayload = req.body;
    
    console.log('Webhook Payload:', JSON.stringify(webhookPayload, null, 2));
    
    // Check if this is an email.received event
    if (webhookPayload.type !== 'email.received') {
      console.log(`Ignoring webhook type: ${webhookPayload.type}`);
      return res.status(200).json({ success: true, message: 'Ignored non-received event' });
    }

    const emailData = webhookPayload.data;
    const emailId = emailData.email_id;

    console.log(`Email ID: ${emailId}`);
    console.log(`From: ${emailData.from}`);
    console.log(`Subject: ${emailData.subject}`);
    console.log(`Email Data Keys:`, Object.keys(emailData));

    // STEP 1: Try to get email content from webhook payload first
    console.log('Checking webhook payload for email content...');
    
    let emailBody = '';
    let fullEmail: any = emailData;
    
    // Check if webhook includes text or html directly
    if (emailData.text || emailData.html) {
      console.log('✅ Email content found in webhook payload');
      emailBody = emailData.text || emailData.html || '';
    } else {
      // STEP 2: Use Resend SDK to fetch received email content
      console.log('Email content not in webhook, fetching using Resend SDK receiving API...');
      
      try {
        // Use Resend SDK's receiving.get() method for inbound emails
        const receivedEmail = await resend.emails.receiving.get(emailId);
        
        if (receivedEmail.data) {
          fullEmail = receivedEmail.data;
          emailBody = fullEmail.text || fullEmail.html || '';
          console.log('✅ Email content retrieved from Resend receiving API');
          console.log(`   Has text: ${!!fullEmail.text}, Has HTML: ${!!fullEmail.html}`);
        } else {
          console.warn('⚠️ Resend receiving API returned no data');
        }
      } catch (fetchError: any) {
        console.error('❌ Error fetching from Resend receiving API:', fetchError.message);
        console.log('   This might indicate the email is not available yet or API permissions issue');
      }
    }

    // STEP 3: If still no body, we need to inform the user
    if (!emailBody || emailBody.trim().length === 0) {
      console.error('❌ No email body available from webhook or Resend API');
      console.log('📋 Available email data:', JSON.stringify(emailData, null, 2));
      
      return res.status(200).json({
        success: false,
        error: 'Email body not available. The email may not have been fully processed yet.',
        hint: 'Resend stores received emails and makes them available via the receiving API. Please try again in a few moments.',
        receivedData: {
          from: emailData.from,
          subject: emailData.subject,
          email_id: emailId,
          hasText: !!emailData.text,
          hasHtml: !!emailData.html,
        },
      });
    }

    // STEP 4: Extract email content (prioritize text, fallback to HTML)
    const from = emailData.from;
    const subject = emailData.subject || fullEmail.subject || '';
    
    // If we have HTML but no text, convert HTML to text
    if (!emailBody.includes('<') && fullEmail.html) {
      // emailBody might be HTML, convert it
      emailBody = emailBody
        .replace(/<style[^>]*>.*?<\/style>/gi, '')
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    }

    console.log(`Body Preview: ${emailBody.substring(0, 200)}...`);
    console.log(`Body Length: ${emailBody.length} characters`);

    // STEP 5: Validate email data
    if (!from || !emailBody) {
      console.log('⚠️  Missing required email fields');
      return res.status(200).json({
        success: false,
        error: 'Missing required email fields (from or body)',
      });
    }

    // STEP 6: Extract RFP ID from subject or body EARLY (before any processing)
    const rfpId = extractRFPId(subject, emailBody);

    if (!rfpId) {
      console.log(`⚠️  Could not extract RFP ID from email`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Body preview: ${emailBody.substring(0, 200)}`);
      
      return res.status(200).json({
        success: true,
        message: 'Email received but no RFP ID found',
        hint: 'Please ensure the RFP ID is included in the email subject or body',
      });
    }

    console.log(`✅ Extracted RFP ID: ${rfpId}`);

    // STEP 7: Verify RFP exists BEFORE storing email
    const rfp = await rfpService.getRFPById(rfpId);

    if (!rfp) {
      console.log(`⚠️  RFP ${rfpId} not found in database`);
      return res.status(200).json({
        success: true,
        message: 'Email received but RFP not found',
      });
    }

    console.log(`✅ Found RFP: ${rfp.title}`);

    // STEP 8: Extract vendor email
    const vendorEmail = extractEmailAddress(from);
    console.log(`Vendor Email: ${vendorEmail}`);

    // STEP 9: Find vendor in database
    const vendor = await vendorService.getVendorByEmail(vendorEmail);
    
    if (!vendor) {
      console.log(`⚠️  No vendor found with email: ${vendorEmail}`);
      return res.status(200).json({
        success: true,
        message: 'Email received but no matching vendor found',
        hint: 'Please ensure the vendor is registered in the system',
      });
    }

    console.log(`✅ Found vendor: ${vendor.name} (ID: ${vendor.id})`);

    // STEP 10: **CRITICAL** - Store email in database FIRST before any AI processing
    console.log('💾 Storing email in database before AI processing...');
    
    const storedEmail = await prismaClient.inboundEmail.create({
      data: {
        emailId: emailId,
        from: from,
        subject: subject,
        rawBody: emailBody,
        rfpId: rfpId,
        vendorId: vendor.id,
        processed: false,
      },
    });

    console.log(`✅ Email stored with ID: ${storedEmail.id}`);

    // STEP 11: Try to process the vendor proposal using AI
    console.log(`🤖 Processing proposal with AI...`);
    console.log(`   Total content length: ${emailBody.length} characters`);
    
    try {
      const result = await rfpService.processVendorProposal(
        rfpId,
        vendorEmail,
        emailBody
      );

      // Update stored email with success
      await prismaClient.inboundEmail.update({
        where: { id: storedEmail.id },
        data: {
          processed: true,
          processedAt: new Date(),
          proposalId: result.proposalId,
        },
      });

      console.log(`✅ Successfully created proposal: ${result.proposalId}`);
      console.log(`   AI Score: ${result.aiScore || 'N/A'}`);
      console.log(`   Total Price: ${result.extractedData?.totalPrice || 'N/A'}`);
      console.log('=============================================\n');

      // Return success to Resend
      return res.status(200).json({
        success: true,
        message: 'Proposal processed successfully',
        data: {
          proposalId: result.proposalId,
          vendorName: vendor.name,
          rfpTitle: rfp.title,
          aiScore: result.aiScore,
      extractedData: result.extractedData,
        },
      });

    } catch (aiError: any) {
      // AI processing failed - use fallback parser to create basic proposal
      console.error('❌ AI Processing Error:', aiError.message);
      console.log('🔧 Using fallback parser to create basic proposal...');
      
      try {
        // Import fallback parser
        const { fallbackParseProposal } = await import('../utils/fallbackParser');
        
        // Parse with fallback
        const fallbackData = fallbackParseProposal(emailBody);
        
        // Create proposal with fallback data
        const fallbackProposal = await prismaClient.proposal.create({
          data: {
            rfpId: rfpId!,
            vendorId: vendor.id,
            rawEmailBody: emailBody,
            extractedData: fallbackData as any,
            aiScore: null, // No AI score available
            aiEvaluation: null,
            usedFallbackParsing: true, // Flag for re-parsing
          },
        });

        // Update RFPVendor status
        await prismaClient.rFPVendor.updateMany({
          where: {
            rfpId: rfpId!,
            vendorId: vendor.id,
          },
          data: {
            status: 'RESPONDED',
          },
        });

        // Update stored email with proposal ID and mark as processed
        await prismaClient.inboundEmail.update({
          where: { id: storedEmail.id },
          data: {
            processed: true,
            processedAt: new Date(),
            proposalId: fallbackProposal.id,
            processingError: `AI quota exceeded. Used fallback parsing. Original error: ${aiError.message}`,
          },
        });

        console.log(`✅ Created proposal with fallback parser: ${fallbackProposal.id}`);
        console.log(`⚠️  Proposal needs AI re-parsing for full analysis`);
        console.log('=============================================\n');

        // Return success with warning
        return res.status(200).json({
          success: true,
          message: 'Proposal created with fallback parsing (AI quota exceeded)',
          warning: 'Proposal created but needs AI re-parsing for full analysis',
          data: {
            proposalId: fallbackProposal.id,
            vendorName: vendor.name,
            rfpTitle: rfp.title,
            usedFallbackParsing: true,
            extractedData: fallbackData,
          },
        });
      } catch (fallbackError: any) {
        // Even fallback failed - store error
        console.error('❌ Fallback parser also failed:', fallbackError.message);
        
        await prismaClient.inboundEmail.update({
          where: { id: storedEmail.id },
          data: {
            processingError: `Both AI and fallback parsing failed. AI: ${aiError.message}, Fallback: ${fallbackError.message}`,
          },
        });

        console.log('💾 Email stored with error - can be re-parsed later');
        console.log('=============================================\n');

        // Still return 200 to Resend (don't retry)
        return res.status(200).json({
          success: false,
          error: `Failed to process vendor proposal: ${aiError.message}`,
          hint: 'Email has been stored and can be re-parsed later when AI quota is available',
          storedEmailId: storedEmail.id,
        });
      }
    }

  } catch (error: any) {
    console.error('❌ Inbound Email Error:', error.message);
    console.error('Stack:', error.stack);
    console.log('=============================================\n');
    
    // Still return 200 to Resend (don't retry)
    return res.status(200).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Extract email address from "Name <email@domain.com>" format
 */
function extractEmailAddress(fromField: string): string {
  const match = fromField.match(/<(.+?)>/);
  return match ? match[1].toLowerCase().trim() : fromField.toLowerCase().trim();
}

/**
 * Extract RFP ID from email subject or body
 * Supports multiple formats:
 * - "RFP ID: abc-123"
 * - "RFP-abc-123"
 * - "Re: RFP abc-123"
 * - Any UUID format
 */
function extractRFPId(subject: string, body: string): string | null {
  const text = `${subject} ${body}`;

  // Pattern 1: RFP ID: {uuid}
  const pattern1 = /RFP\s*ID\s*[:\s-]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
  const match1 = text.match(pattern1);
  if (match1) return match1[1];

  // Pattern 2: RFP-{uuid} or RFP {uuid}
  const pattern2 = /RFP[:\s-]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
  const match2 = text.match(pattern2);
  if (match2) return match2[1];

  // Pattern 3: Just find any UUID (most permissive)
  const pattern3 = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
  const match3 = text.match(pattern3);
  if (match3) return match3[1];

  return null;
}