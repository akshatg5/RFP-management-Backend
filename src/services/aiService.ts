import { GoogleGenerativeAI } from "@google/generative-ai";
import { StructuredRFP } from "../types/rfpTypes";
import { SYSTEM_PROMPT_PROMPT_TO_RFP } from "./systemPrompt";

export class AIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI API KEY IS MISSING");
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
    });
  }

  // Convert natural language procurement request into structured RFP
  async structuredRFPFromNaturalLanguage(
    prompt: string
  ): Promise<StructuredRFP> {
    try {
      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT_PROMPT_TO_RFP }],
          },
          {
            role: "user",
            parts: [
              {
                text: `Convert this procurement request into structured Request For proposal Data : \r\n ${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      });

      const response = await result.response;
      let text = response.text().trim();

      text = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const structuredData: StructuredRFP = JSON.parse(text);

      return structuredData;
    } catch (error: any) {
      console.error(
        "AI Service Error (Structure RFP):",
        error.message || error
      );
      throw new Error(
        `Failed to structure RFP from natural language: ${error.message}`
      );
    }
  }

  // Parse vendor email response and extract structured proposal data
  // Enhanced to handle messy, free-form text with tables and various formats
  async parseVendorProposal(
    emailBody: string,
    rfpData: StructuredRFP
  ): Promise<{
    extractedData: any;
    totalPrice?: number;
    deliveryDays?: number;
    paymentTerms?: string | string[];
    warranty?: string;
  }> {
    try {
      const SYSTEM_PROMPT_PARSE_VENDOR_PROPOSAL = `
You are an expert at parsing vendor proposals from messy email responses. 
Vendors may use free-form text, tables, bullet points, or other formats.

Your task is to extract structured data from the vendor's response.

ORIGINAL RFP REQUESTED:
${JSON.stringify(rfpData, null, 2)}

EXTRACTION REQUIREMENTS:
1. items: Array of quoted items with:
   - name: Product/service name (match to RFP items as closely as possible)
   - quantity: Quantity quoted
   - unitPrice: Price per unit (extract number only)
   - totalPrice: Total for this line item
   - specifications: Any specs mentioned (object with key-value pairs)

2. totalPrice: Overall total price quoted (number only, no currency symbols)

3. deliveryDays: Delivery timeline converted to DAYS (number only)
   - "2 weeks" → 14
   - "1 month" → 30
   - "immediate" → 1

4. paymentTerms: Payment terms as a string or array of strings
   - Examples: "Net 30", "50% upfront, 50% on delivery", ["COD", "Net 30"]

5. warranty: Warranty information as a string
   - Examples: "1 year", "90 days parts and labor"

6. additionalServices: Array of any extra services/benefits offered
   - Examples: ["Free installation", "24/7 support", "Training included"]

7. notes: Any important conditions, caveats, or special terms

8. confidence: Your confidence in the extraction (0-100)
   - 100: All data clearly stated
   - 75: Most data found, some assumptions
   - 50: Significant gaps or ambiguity
   - 25: Very incomplete or unclear

IMPORTANT HANDLING RULES:
- If a field is not mentioned, use null (not 0 or "")
- Extract numbers from text (e.g., "$1,250.00" → 1250)
- Handle variations: "two weeks" → 14 days
- Match items to RFP items even if names slightly differ
- If vendor provides a table, parse each row
- If vendor only gives total price without breakdown, create items with estimates
- Look for pricing in MULTIPLE formats: tables, bullet lists, inline text
- Be flexible with terminology (quote/proposal, cost/price, etc.)

RESPONSE FORMAT:
Respond ONLY with valid JSON. No markdown, no preamble, no explanations.

EXAMPLE RESPONSE:
{
  "items": [
    {"name": "Laptop", "quantity": 5, "specifications": {"ram": "16GB", "storage": "512GB SSD"}},
    {"name": "Monitor", "quantity": 5, "specifications": {"size": "27-inch", "resolution": "4K"}}
  ],
  "totalPrice": 12500,
  "deliveryDays": 14,
  "paymentTerms": "Net 30",
  "warranty": "2 years",
  "additionalServices": ["Installation", "Training"],
  "notes": "Includes setup and configuration",
  "confidence": 85
}

YOUR RESPONSE MUST BE VALID JSON:
`;

      console.log('📧 Sending email to AI for parsing...');
      console.log(`   Email length: ${emailBody.length} characters`);

      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT_PARSE_VENDOR_PROPOSAL }],
          },
          {
            role: "user",
            parts: [{ text: `VENDOR EMAIL RESPONSE:\n\n${emailBody}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 3072, // Increased for complex responses
        },
      });

      const response = await result.response;
      let text = response.text().trim();

      // Clean up response
      text = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      console.log('🤖 AI Response Preview:', text.substring(0, 300));

      const parsedData = JSON.parse(text);

      console.log(`✅ Extracted proposal data (confidence: ${parsedData.confidence || 'N/A'}%)`);
      console.log(`   Items: ${parsedData.items?.length || 0}`);
      console.log(`   Total Price: $${parsedData.totalPrice || 'N/A'}`);

      return {
        extractedData: parsedData,
        totalPrice: parsedData.totalPrice,
        deliveryDays: parsedData.deliveryDays,
        paymentTerms: parsedData.paymentTerms,
        warranty: parsedData.warranty,
      };
    } catch (error: any) {
      console.error(
        "AI service Error (Parsing Proposal):",
        error.message || error
      );
      throw new Error(`Failed to parse vendor proposal: ${error.message}`);
    }
  }

  // Score and evaluate a vendor proposal against RFP requirements
  async scoreProposal(
    rfpData: StructuredRFP,
    proposalData: any,
    vendorName: string
  ): Promise<{
    score: number;
    evaluation: string;
  }> {
    try {
      const SYSTEM_PROMPT_SCORE_PROPOSAL = `You are an expert procurement evaluator. Score vendor proposals on a scale of 0-100.

Evaluation criteria:
1. Price competitiveness (30 points)
   - Compare against budget if provided
   - Consider value for money
   - Deduct points for over-budget quotes

2. Delivery timeline (20 points)
   - Compare against required timeline
   - Faster = better (within reason)
   - Deduct for delays

3. Completeness (20 points)
   - All RFP items quoted
   - Clear specifications
   - No missing information

4. Terms and conditions (15 points)
   - Favorable payment terms
   - Adequate warranty
   - Reasonable conditions

5. Additional value (15 points)
   - Extra services offered
   - Support and training
   - Quality indicators

6. Confidence penalty (apply if present)
   - If confidence < 75%, deduct up to 10 points
   - Low confidence indicates unclear proposal

SCORING GUIDELINES:
- 90-100: Exceptional proposal, exceeds requirements
- 75-89: Strong proposal, meets all requirements well
- 60-74: Good proposal, meets most requirements
- 40-59: Acceptable proposal, has some gaps
- 0-39: Poor proposal, significant issues

RFP Requirements:
${JSON.stringify(rfpData, null, 2)}

Vendor Proposal from ${vendorName}:
${JSON.stringify(proposalData, null, 2)}

Provide:
- score: Number between 0-100
- evaluation: Detailed 3-5 sentence evaluation explaining the score, highlighting strengths and weaknesses

EXAMPLE RESPONSE:
{"score": 87, "evaluation": "This proposal offers excellent value with competitive pricing and fast delivery. The vendor demonstrates strong technical expertise and provides comprehensive warranty coverage. Minor concerns about payment terms could be negotiated."}

YOUR RESPONSE MUST BE VALID JSON:`;

      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT_SCORE_PROPOSAL }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
      });

      const response = await result.response;
      let text = response.text().trim();

      // Clean up the response text
      text = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .replace(/```/g, "")
        .trim();

      const scoringData = JSON.parse(text);

      return {
        score: Math.min(100, Math.max(0, scoringData.score)),
        evaluation: scoringData.evaluation,
      };
    } catch (error: any) {
      console.error(
        "AI Service Error (scoreProposal):",
        error.message || error
      );
      throw new Error(`Failed to score proposal: ${error.message}`);
    }
  }

  // Compare multiple proposals and provide recommendation
  async compareProposalsAndRecommend(
    rfpData: StructuredRFP,
    proposals: Array<{
      vendorName: string;
      vendorId: string;
      extractedData: any;
      aiScore?: number;
      aiEvaluation?: string;
    }>
  ): Promise<{
    recommendedVendorId: string;
    reasoning: string;
    comparisonSummary: string;
  }> {
    try {
      const SYSTEM_PROMPT_COMPARE_PROPOSALS = `You are an expert procurement advisor. Compare vendor proposals and recommend the best option.

Consider:
- Overall value for money
- Delivery capability
- Terms and conditions
- Risk factors
- AI scores and evaluations
- Completeness and clarity

Provide:
- recommendedVendorId: The vendor ID of your recommendation
- reasoning: 3-4 sentences explaining why this vendor is recommended
- comparisonSummary: 4-6 sentences comparing all vendors objectively, mentioning key differentiators

RFP Requirements:
${JSON.stringify(rfpData, null, 2)}

Vendor Proposals:
${JSON.stringify(proposals, null, 2)}

EXAMPLE RESPONSE:
{
  "recommendedVendorId": "vendor-123",
  "reasoning": "TechCorp offers the best overall value with competitive pricing, proven reliability, and comprehensive service offerings. Their delivery timeline aligns perfectly with project requirements while providing excellent warranty coverage.",
  "comparisonSummary": "TechCorp leads with a 92/100 score due to superior pricing and service quality. DataSys follows closely at 88/100 with strong technical capabilities but higher costs. BudgetCorp offers the lowest price at 76/100 but lacks comprehensive support services."
}

YOUR RESPONSE MUST BE VALID JSON:`

      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT_COMPARE_PROPOSALS }],
          },
        ],
        generationConfig: {
          temperature: 0.5,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1536,
        },
      });

      const response = await result.response;
      return response;
    } catch (error: any) {
      console.error(
        "AI Service Error (compareProposals):",
        error.message || error
      );
      throw new Error(`Failed to compare proposals: ${error.message}`);
    }
  }

  // Generate professional RFP email content
  async generateRFPEmailContent(
    rfpData: StructuredRFP,
    vendorName: string
  ): Promise<{
    subject: string;
    body: string;
  }> {
    try {
      const SYSTEM_PROMPT_GENERATE_EMAIL = `You are a professional procurement officer. Generate a formal RFP email.

Create:
- subject: Professional email subject line (include RFP ID for tracking)
- body: Professional email body that includes all RFP details in a clear, structured format

RFP Details:
${JSON.stringify(rfpData, null, 2)}

The email should:
1. Be professional and courteous
2. Clearly state all requirements
3. Include the RFP ID prominently for easy reference
4. Include deadlines if specified
5. Request a detailed quotation
6. Provide clear instructions for response

IMPORTANT: 
- The body text must NOT contain any unescaped quotes or newlines
- Replace all newlines with \\n
- Escape all quotes properly
- Respond with valid JSON only

Respond ONLY with valid JSON in this exact format:
{"subject": "your subject here", "body": "your email body with \\n for newlines"}`;

      const result = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${SYSTEM_PROMPT_GENERATE_EMAIL}\n\nVendor Name: ${vendorName}` }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1536,
        },
      });

      const response = await result.response;
      let text = response.text().trim();

      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let emailContent;
      try {
        emailContent = JSON.parse(text);
      } catch (parseError) {
        console.warn('JSON parsing failed, using fallback method');
        
        emailContent = {
          subject: `RFP: ${rfpData.title} (ID: ${rfpData.id || 'TBD'})`,
          body: this.generateFallbackEmailBody(rfpData, vendorName)
        };
      }

      return emailContent;
    } catch (error: any) {
      console.error('AI Service Error (generateEmail):', error.message || error);
      
      console.log('Using fallback email generation');
      return {
        subject: `RFP: ${rfpData.title}`,
        body: this.generateFallbackEmailBody(rfpData, vendorName)
      };
    }
  }

  private generateFallbackEmailBody(rfpData: StructuredRFP, vendorName: string): string {
    const items = rfpData.items.map(item => 
      `- ${item.name}: ${item.quantity} units${item.specifications ? ' (' + Object.entries(item.specifications).map(([k, v]) => `${k}: ${v}`).join(', ') + ')' : ''}`
    ).join('\n');

    return `Dear ${vendorName},

We are pleased to invite you to submit a proposal for the following procurement:

${rfpData.description}

RFP ID: ${rfpData.id || 'TBD'}
(Please include this ID in your response subject line)

REQUIREMENTS:
${items}

${rfpData.budget ? `Budget: $${rfpData.budget.toLocaleString()}` : ''}
${rfpData.deliveryDays ? `Delivery Timeline: ${rfpData.deliveryDays} days` : ''}
${rfpData.paymentTerms ? `Payment Terms: ${rfpData.paymentTerms}` : ''}
${rfpData.warrantyYears ? `Warranty Required: ${rfpData.warrantyYears} year(s)` : ''}

${rfpData.additionalRequirements && rfpData.additionalRequirements.length > 0 ? 
  `ADDITIONAL REQUIREMENTS:\n${rfpData.additionalRequirements.map(req => `- ${req}`).join('\n')}\n` : ''}

Please provide a detailed quotation including:
1. Item-by-item pricing
2. Total cost
3. Delivery timeline
4. Payment terms
5. Warranty information
6. Any additional services or benefits

IMPORTANT: Please include the RFP ID (${rfpData.id || 'TBD'}) in your email response subject line.

We look forward to receiving your proposal.

Best regards,
Procurement Team`;
  }
}