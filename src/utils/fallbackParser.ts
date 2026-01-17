/**
 * Fallback parser for vendor proposals when AI is unavailable
 * Extracts basic information using regex patterns
 */
function fallbackParseProposal(emailBody: string): any {
  console.log('🔧 Using fallback parser (AI unavailable)');
  
  const extractedData: any = {
    items: [],
    totalPrice: null,
    deliveryDays: null,
    paymentTerms: null,
    warrantyYears: null,
    notes: emailBody.substring(0, 500), // Store first 500 chars as notes
  };

  // Extract total price/cost
  const pricePatterns = [
    /total[:\s]+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
    /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{2})?)\s*total/i,
    /price[:\s]+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
    /cost[:\s]+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = emailBody.match(pattern);
    if (match) {
      extractedData.totalPrice = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  // Extract delivery time
  const deliveryPatterns = [
    /delivery[:\s]+(\d+)\s*days?/i,
    /(\d+)\s*days?\s+delivery/i,
    /timeline[:\s]+(\d+)\s*days?/i,
  ];

  for (const pattern of deliveryPatterns) {
    const match = emailBody.match(pattern);
    if (match) {
      extractedData.deliveryDays = parseInt(match[1]);
      break;
    }
  }

  // Extract warranty
  const warrantyPatterns = [
    /warranty[:\s]+(\d+)\s*years?/i,
    /(\d+)\s*years?\s+warranty/i,
  ];

  for (const pattern of warrantyPatterns) {
    const match = emailBody.match(pattern);
    if (match) {
      extractedData.warrantyYears = parseInt(match[1]);
      break;
    }
  }

  // Extract payment terms
  const paymentPatterns = [
    /payment[:\s]+([^\n.]+)/i,
    /terms[:\s]+([^\n.]+)/i,
  ];

  for (const pattern of paymentPatterns) {
    const match = emailBody.match(pattern);
    if (match) {
      extractedData.paymentTerms = match[1].trim().substring(0, 100);
      break;
    }
  }

  console.log('📊 Fallback extraction results:', {
    totalPrice: extractedData.totalPrice,
    deliveryDays: extractedData.deliveryDays,
    warrantyYears: extractedData.warrantyYears,
    hasPaymentTerms: !!extractedData.paymentTerms,
  });

  return extractedData;
}

export { fallbackParseProposal };
