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
      model: "gemini-2.5-flash-lite",
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

      console.log("AI structuring failed, using fallback RFP parser...");
      // Use fallback parsing when AI fails
      return this.generateFallbackStructuredRFP(prompt);
    }
  }

  // Public method for preview - structure RFP without saving
  async structureRFPOnly(prompt: string): Promise<StructuredRFP> {
    return this.structuredRFPFromNaturalLanguage(prompt);
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

      console.log("📧 Sending email to AI for parsing...");
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

      console.log("🤖 AI Response Preview:", text.substring(0, 300));

      const parsedData = JSON.parse(text);

      console.log(
        `✅ Extracted proposal data (confidence: ${
          parsedData.confidence || "N/A"
        }%)`
      );
      console.log(`   Items: ${parsedData.items?.length || 0}`);
      console.log(`   Total Price: $${parsedData.totalPrice || "N/A"}`);

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
      // Calculate reference values for scoring
      const budgetInfo = rfpData.budget
        ? `Budget: $${rfpData.budget}`
        : "No budget specified";
      const deliveryInfo = rfpData.deliveryDays
        ? `Required delivery: ${rfpData.deliveryDays} days`
        : "No delivery timeline specified";

      const SYSTEM_PROMPT_SCORE_PROPOSAL = `You are an expert procurement evaluator. Score this vendor proposal on a scale of 0-100.

**CRITICAL SCORING RULES:**

1. **Price Competitiveness (30 points)**
   ${
     rfpData.budget
       ? `
   - If price <= budget: 30 points
   - If price is 1-10% over budget: 20 points
   - If price is 11-20% over budget: 10 points
   - If price is >20% over budget: 5 points
   - LOWER price is ALWAYS better (all else equal)
   `
       : `
   - Since no budget specified, score based on relative value
   - Consider if pricing seems reasonable for items requested
   `
   }

2. **Delivery Timeline (20 points)**
   ${
     rfpData.deliveryDays
       ? `
   - If delivery <= required days: 20 points
   - If delivery is 1-5 days late: 15 points
   - If delivery is 6-10 days late: 10 points
   - If delivery is >10 days late: 5 points
   - FASTER delivery is BETTER (all else equal)
   `
       : `
   - Score based on how quickly they can deliver
   - Faster = higher score
   `
   }

3. **Completeness (20 points)**
   - All items quoted with specs: 20 points
   - Most items quoted: 15 points
   - Some items missing: 10 points
   - Significant gaps: 5 points

4. **Terms and Conditions (15 points)**
   - Favorable payment terms: up to 8 points
   - Good warranty coverage: up to 7 points

5. **Additional Value (15 points)**
   - Extra services/support: up to 10 points
   - Quality indicators: up to 5 points

**RFP REQUIREMENTS:**
${JSON.stringify(rfpData, null, 2)}

**VENDOR PROPOSAL from ${vendorName}:**
${JSON.stringify(proposalData, null, 2)}

**ANALYSIS CHECKLIST:**
- Proposed price: $${proposalData.totalPrice || "N/A"} vs ${budgetInfo}
- Proposed delivery: ${
        proposalData.deliveryDays || "N/A"
      } days vs ${deliveryInfo}
- Is price within budget? ${
        rfpData.budget
          ? proposalData.totalPrice <= rfpData.budget
            ? "YES ✓"
            : "NO ✗ (PENALTY)"
          : "N/A"
      }
- Is delivery on time? ${
        rfpData.deliveryDays
          ? proposalData.deliveryDays <= rfpData.deliveryDays
            ? "YES ✓"
            : "NO ✗ (PENALTY)"
          : "N/A"
      }

**IMPORTANT:** 
- A proposal with HIGHER price and LATER delivery should score LOWER
- Calculate the exact point deductions based on the criteria above
- Be objective and mathematical in your scoring

Respond with ONLY valid JSON:
{
  "score": <number 0-100>,
  "evaluation": "<2-3 sentences explaining the score with specific numbers>",
  "breakdown": {
    "price": <0-30>,
    "delivery": <0-20>,
    "completeness": <0-20>,
    "terms": <0-15>,
    "value": <0-15>
  }
}`;

      console.log("🎯 Sending proposal to AI for scoring...");
      console.log(`   Vendor: ${vendorName}`);
      console.log(
        `   Price: $${proposalData.totalPrice || "N/A"} (Budget: $${
          rfpData.budget || "N/A"
        })`
      );
      console.log(
        `   Delivery: ${proposalData.deliveryDays || "N/A"} days (Required: ${
          rfpData.deliveryDays || "N/A"
        })`
      );

      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT_SCORE_PROPOSAL }],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Very low for consistent scoring
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      });

      const response = await result.response;
      let text = response.text().trim();

      console.log("📊 Raw scoring response:", text.substring(0, 300));

      // Cleanup
      text = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .replace(/```/g, "")
        .trim();

      // Extract JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }

      let scoringData;
      try {
        scoringData = JSON.parse(text);
      } catch (parseError) {
        console.error("❌ JSON parse failed. Raw text:", text);
        console.error("Parse error:", parseError);

        // Fallback with manual calculation
        const score = this.calculateFallbackScore(rfpData, proposalData);

        return {
          score,
          evaluation: `Automated scoring: ${score}/100. Price: $${
            proposalData.totalPrice || "N/A"
          }, Delivery: ${
            proposalData.deliveryDays || "N/A"
          } days. Manual review recommended.`,
        };
      }

      // Validate score
      const finalScore = Math.min(100, Math.max(0, scoringData.score || 0));

      console.log(`✅ Proposal scored: ${finalScore}/100`);
      if (scoringData.breakdown) {
        console.log(`   Breakdown:`, scoringData.breakdown);
      }

      return {
        score: finalScore,
        evaluation: scoringData.evaluation || "No evaluation provided",
      };
    } catch (error: any) {
      console.error(
        "AI Service Error (scoreProposal):",
        error.message || error
      );
      throw new Error(`Failed to score proposal: ${error.message}`);
    }
  }

  // Fallback manual scoring when AI fails
  private calculateFallbackScore(
    rfpData: StructuredRFP,
    proposalData: any
  ): number {
    let score = 0;

    // Price scoring (30 points)
    if (rfpData.budget && proposalData.totalPrice) {
      const priceRatio = proposalData.totalPrice / rfpData.budget;
      if (priceRatio <= 1.0) score += 30;
      else if (priceRatio <= 1.1) score += 20;
      else if (priceRatio <= 1.2) score += 10;
      else score += 5;
    } else {
      score += 15; // Neutral if no budget
    }

    // Delivery scoring (20 points)
    if (rfpData.deliveryDays && proposalData.deliveryDays) {
      const deliveryDiff = proposalData.deliveryDays - rfpData.deliveryDays;
      if (deliveryDiff <= 0) score += 20;
      else if (deliveryDiff <= 5) score += 15;
      else if (deliveryDiff <= 10) score += 10;
      else score += 5;
    } else {
      score += 10; // Neutral if no timeline
    }

    // Completeness (20 points)
    if (proposalData.items && proposalData.items.length > 0) {
      score += 20;
    } else {
      score += 10;
    }

    // Terms (15 points)
    if (proposalData.paymentTerms) score += 8;
    if (proposalData.warranty) score += 7;

    // Additional value (15 points)
    if (
      proposalData.additionalServices &&
      proposalData.additionalServices.length > 0
    ) {
      score += 10;
    } else {
      score += 5;
    }

    console.log(`📊 Fallback score calculated: ${score}/100`);
    return score;
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

YOUR RESPONSE MUST BE VALID JSON:`;

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
      const text = response.text();

      console.log("✅ AI Comparison complete");

      // Parse the JSON from the response text
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        
        const recommendation = JSON.parse(jsonText);
        
        return {
          recommendedVendorId: recommendation.recommendedVendorId,
          reasoning: recommendation.reasoning,
          comparisonSummary: recommendation.comparisonSummary,
        };
      } catch (parseError) {
        console.error("Failed to parse AI recommendation JSON:", parseError);
        console.log("Raw AI response:", text);
        
        // Return a fallback structure
        return {
          recommendedVendorId: proposals[0]?.vendorId || "",
          reasoning: "Unable to parse AI recommendation. Please review proposals manually.",
          comparisonSummary: text,
        };
      }
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
7. MUST include submission instructions: "Send your proposal response to: rfp-responses@ulkeazilea.resend.app"
8. MUST remind vendor to include RFP ID in subject line

IMPORTANT: 
- The body text must NOT contain any unescaped quotes or newlines
- Replace all newlines with \\n
- Escape all quotes properly
- Respond with valid JSON only
- ALWAYS include the response email address: rfp-responses@ulkeazilea.resend.app

Respond ONLY with valid JSON in this exact format:
{"subject": "your subject here", "body": "your email body with \\n for newlines"}`;

      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${SYSTEM_PROMPT_GENERATE_EMAIL}\n\nVendor Name: ${vendorName}`,
              },
            ],
          },
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

      text = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      let emailContent;
      try {
        emailContent = JSON.parse(text);
      } catch (parseError) {
        console.warn("JSON parsing failed, using fallback method");

        emailContent = {
          subject: `RFP: ${rfpData.title} (ID: ${rfpData.id || "TBD"})`,
          body: this.generateFallbackEmailBody(rfpData, vendorName),
        };
      }

      return emailContent;
    } catch (error: any) {
      console.error(
        "AI Service Error (generateEmail):",
        error.message || error
      );

      console.log("Using fallback email generation");
      return {
        subject: `RFP: ${rfpData.title}`,
        body: this.generateFallbackEmailBody(rfpData, vendorName),
      };
    }
  }

  private generateFallbackEmailBody(
    rfpData: StructuredRFP,
    vendorName: string
  ): string {
    const items = rfpData.items
      .map(
        (item) =>
          `- ${item.name}: ${item.quantity} units${
            item.specifications
              ? " (" +
                Object.entries(item.specifications)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ") +
                ")"
              : ""
          }`
      )
      .join("\n");

    return `Dear ${vendorName},
  
  We are pleased to invite you to submit a proposal for the following procurement:
  
  ${rfpData.description}
  
  RFP ID: ${rfpData.id || "TBD"}
  (Please include this ID in your response subject line)
  
  REQUIREMENTS:
  ${items}
  
  ${rfpData.budget ? `Budget: $${rfpData.budget.toLocaleString()}` : ""}
  ${
    rfpData.deliveryDays
      ? `Delivery Timeline: ${rfpData.deliveryDays} days`
      : ""
  }
  ${rfpData.paymentTerms ? `Payment Terms: ${rfpData.paymentTerms}` : ""}
  ${
    rfpData.warrantyYears
      ? `Warranty Required: ${rfpData.warrantyYears} year(s)`
      : ""
  }
  
  ${
    rfpData.additionalRequirements && rfpData.additionalRequirements.length > 0
      ? `ADDITIONAL REQUIREMENTS:\n${rfpData.additionalRequirements
          .map((req) => `- ${req}`)
          .join("\n")}\n`
      : ""
  }
  
  Please provide a detailed quotation including:
  1. Item-by-item pricing
  2. Total cost
  3. Delivery timeline
  4. Payment terms
  5. Warranty information
  6. Any additional services or benefits
  
  IMPORTANT SUBMISSION INSTRUCTIONS:
  - Include RFP ID (${rfpData.id || "TBD"}) in your email subject line
  - Send your proposal response to: rfp-responses@ulkeazilea.resend.app
  
  We look forward to receiving your proposal.
  
  Best regards,
  Procurement Team`;
  }

  // Fallback RFP structuring when AI is unavailable
  private generateFallbackStructuredRFP(prompt: string): StructuredRFP {
    console.log("🔧 Generating fallback structured RFP from prompt...");

    const lowerPrompt = prompt.toLowerCase();

    // Extract title - use first sentence or first 50 chars
    const titleMatch = prompt.match(/^([^.!?\n]+)/);
    const title = titleMatch
      ? titleMatch[1].trim().substring(0, 100)
      : prompt.substring(0, 50).trim() + "...";

    // Extract budget - look for dollar amounts
    let budget: number | undefined;
    const budgetPatterns = [
      /budget\s+is\s+\$?([\d,]+)/i,
      /budget[:\s]+\$?([\d,]+)/i,
      /\$\s*([\d,]+)\s+total/i,
      /\$\s*([\d,]+)\s*budget/i,
      /up\s+to\s+\$?([\d,]+)/i,
      /maximum\s+\$?([\d,]+)/i,
    ];

    for (const pattern of budgetPatterns) {
      const match = prompt.match(pattern);
      if (match) {
        budget = parseInt(match[1].replace(/,/g, ""));
        break;
      }
    }

    // Extract delivery timeline - look for days/weeks/months
    let deliveryDays: number | undefined;
    const deliveryPatterns = [
      /(\d+)\s*days?/i,
      /(\d+)\s*weeks?/i,
      /(\d+)\s*months?/i,
    ];

    for (const pattern of deliveryPatterns) {
      const match = prompt.match(pattern);
      if (match) {
        const value = parseInt(match[1]);
        if (pattern.source.includes("week")) {
          deliveryDays = value * 7;
        } else if (pattern.source.includes("month")) {
          deliveryDays = value * 30;
        } else {
          deliveryDays = value;
        }
        break;
      }
    }

    // Extract payment terms
    let paymentTerms: string | undefined;
    if (lowerPrompt.includes("net 30")) {
      paymentTerms = "Net 30";
    } else if (lowerPrompt.includes("net 60")) {
      paymentTerms = "Net 60";
    } else if (
      lowerPrompt.includes("upfront") ||
      lowerPrompt.includes("advance")
    ) {
      paymentTerms = "Payment in advance";
    } else if (
      lowerPrompt.includes("cod") ||
      lowerPrompt.includes("cash on delivery")
    ) {
      paymentTerms = "Cash on Delivery";
    }

    // Extract warranty
    let warrantyYears: number | undefined;
    const warrantyPatterns = [
      /(?:at\s+least\s+)?(\d+)\s*years?\s*warranty/i,
      /warranty[:\s]+(\d+)\s*years?/i,
      /(\d+)\s*year\s*warranty/i,
    ];

    for (const pattern of warrantyPatterns) {
      const match = prompt.match(pattern);
      if (match) {
        warrantyYears = parseInt(match[1]);
        break;
      }
    }

    // Extract items - look for quantities and product names
    const items: Array<{
      name: string;
      quantity: number;
      specifications?: Record<string, string>;
    }> = [];

    // More sophisticated item extraction
    // Pattern 1: "20 laptops with..." or "15 monitors that are..."
    const itemPattern1 =
      /(\d+)\s+(laptops?|monitors?|desktops?|computers?|tablets?|phones?|keyboards?|mice|printers?|scanners?|routers?|switches?|servers?|chairs?|desks?|projectors?)/gi;

    let match;
    const foundItems = new Set<string>();

    while ((match = itemPattern1.exec(prompt)) !== null) {
      const quantity = parseInt(match[1]);
      let name = match[2].toLowerCase();

      // Normalize plural forms
      if (name.endsWith("s") && name !== "mice") {
        name = name.slice(0, -1);
      }
      if (name === "mice") {
        name = "mouse";
      }

      // Capitalize
      name = name.charAt(0).toUpperCase() + name.slice(1);

      // Avoid duplicates
      if (!foundItems.has(name.toLowerCase())) {
        foundItems.add(name.toLowerCase());

        // Try to extract specifications for this item
        const specs: Record<string, string> = {};

        // Look for specs after the item mention
        const itemContext = prompt.substring(match.index, match.index + 200);

        // Extract RAM
        const ramMatch = itemContext.match(/(\d+)\s*GB\s*RAM/i);
        if (ramMatch) specs.ram = `${ramMatch[1]}GB`;

        // Extract storage
        const storageMatch = itemContext.match(/(\d+)\s*GB\s*SSD/i);
        if (storageMatch) specs.storage = `${storageMatch[1]}GB SSD`;

        // Extract processor
        const processorMatch = itemContext.match(
          /(Intel\s+[iI]\d+|AMD\s+Ryzen\s+\d+|M\d+\s+(?:Pro|Max)?)/i
        );
        if (processorMatch) specs.processor = processorMatch[1];

        // Extract screen size
        const screenMatch = itemContext.match(/(\d+)-inch/i);
        if (screenMatch) specs.screenSize = `${screenMatch[1]}-inch`;

        // Extract resolution
        const resMatch = itemContext.match(/(4K|1080p|1440p|2K|Full\s*HD)/i);
        if (resMatch) specs.resolution = resMatch[1];

        items.push({
          name,
          quantity,
          specifications: Object.keys(specs).length > 0 ? specs : undefined,
        });
      }
    }

    // If no items found with specific patterns, try generic pattern
    if (items.length === 0) {
      const genericPattern = /(\d+)\s+([a-z]{3,}(?:\s+[a-z]+)?)/gi;
      const matches = [...prompt.matchAll(genericPattern)];

      for (const m of matches.slice(0, 3)) {
        // Limit to first 3 matches
        const quantity = parseInt(m[1]);
        const name = m[2].trim();

        // Filter out common words that aren't items
        const skipWords = [
          "days",
          "day",
          "years",
          "year",
          "total",
          "least",
          "inch",
        ];
        if (
          !skipWords.includes(name.toLowerCase()) &&
          quantity > 0 &&
          quantity < 10000
        ) {
          items.push({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            quantity,
          });
        }
      }
    }

    // If still no items found, create a generic item from the prompt
    if (items.length === 0) {
      items.push({
        name: "Procurement Item",
        quantity: 1,
        specifications: {
          description: prompt.substring(0, 200),
        },
      });
    }

    // Extract additional requirements
    const additionalRequirements: string[] = [];

    if (lowerPrompt.includes("warranty")) {
      additionalRequirements.push("Warranty coverage required");
    }
    if (
      lowerPrompt.includes("support") ||
      lowerPrompt.includes("maintenance")
    ) {
      additionalRequirements.push("Technical support and maintenance");
    }
    if (lowerPrompt.includes("training")) {
      additionalRequirements.push("Training and documentation");
    }
    if (lowerPrompt.includes("installation") || lowerPrompt.includes("setup")) {
      additionalRequirements.push("Installation and setup services");
    }

    const structuredRFP: StructuredRFP = {
      title,
      description: prompt,
      items,
      budget,
      deliveryDays,
      paymentTerms,
      warrantyYears,
      additionalRequirements:
        additionalRequirements.length > 0 ? additionalRequirements : undefined,
    };

    console.log("✅ Fallback RFP structure generated:");
    console.log(`   Title: ${title}`);
    console.log(`   Items: ${items.length}`);
    console.log(`   Budget: ${budget ? `$${budget}` : "Not specified"}`);
    console.log(
      `   Delivery: ${deliveryDays ? `${deliveryDays} days` : "Not specified"}`
    );

    return structuredRFP;
  }
}
