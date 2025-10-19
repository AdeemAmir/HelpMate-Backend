const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Get the Gemini Pro model
const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
    },
    safetySettings: [
        {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
    ],
});

// Analyze medical report
const analyzeMedicalReport = async (fileData, fileType, reportType) => {
    const startTime = Date.now();
    try {

        let prompt = `You are a medical AI assistant specializing in analyzing medical reports. 
    Analyze the following ${fileType} medical report and provide a comprehensive analysis.

    Report Type: ${reportType}
    
    Please provide your analysis in the following JSON format:
    {
      "summary": {
        "english": "Clear, concise summary in English",
        "urdu": "Roman Urdu translation of the summary"
      },
      "keyFindings": [
        {
          "parameter": "Parameter name",
          "value": "Measured value",
          "unit": "Unit of measurement",
          "status": "normal|high|low|abnormal|critical",
          "normalRange": "Normal range",
          "significance": {
            "english": "What this means in English",
            "urdu": "Roman Urdu explanation"
          }
        }
      ],
      "recommendations": {
        "english": ["Recommendation 1", "Recommendation 2"],
        "urdu": ["Roman Urdu recommendation 1", "Roman Urdu recommendation 2"]
      },
      "doctorQuestions": {
        "english": ["Question 1 for doctor", "Question 2 for doctor"],
        "urdu": ["Roman Urdu question 1", "Roman Urdu question 2"]
      },
      "riskFactors": [
        {
          "factor": "Risk factor name",
          "level": "low|medium|high",
          "description": {
            "english": "Description in English",
            "urdu": "Roman Urdu description"
          }
        }
      ],
      "followUpRequired": true/false,
      "followUpTimeframe": "1-week|2-weeks|1-month|3-months|6-months|1-year",
      "confidence": 85
    }

    Important guidelines:
    1. Be accurate and professional
    2. Use simple, clear language
    3. Provide Roman Urdu translations (not Urdu script)
    4. Focus on actionable insights
    5. Highlight any critical or abnormal values
    6. Provide practical recommendations
    7. Ask relevant questions for doctor consultation
    8. Assess risk factors appropriately
    9. Set confidence level based on clarity of report
    10. If report is unclear or incomplete, mention this in confidence level

    Medical Report Content:`;

        // For images, we'll use the multimodal capabilities
        if (fileType === 'image') {
            // Ensure we have a Buffer
            if (!Buffer.isBuffer(fileData)) {
                throw new Error('Image data must be a Buffer');
            }

            // Determine MIME type based on file signature
            let mimeType = 'image/jpeg'; // default
            const signature = fileData.toString('hex', 0, 4);
            if (signature.startsWith('ffd8')) {
                mimeType = 'image/jpeg';
            } else if (signature.startsWith('8950')) {
                mimeType = 'image/png';
            } else if (signature.startsWith('4749')) {
                mimeType = 'image/gif';
            } else if (signature.startsWith('424d')) {
                mimeType = 'image/bmp';
            }

            // Convert buffer to base64
            const base64Data = fileData.toString('base64');

            const imagePart = {
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType
                }
            };

            console.log(`Sending image to Gemini: ${fileData.length} bytes, MIME: ${mimeType}, Base64 length: ${base64Data.length}`);

            try {
                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                const text = response.text();
                console.log('Gemini response received:', text.substring(0, 200) + '...');

                return {
                    success: true,
                    data: parseGeminiResponse(text),
                    processingTime: Date.now() - startTime
                };
            } catch (geminiError) {
                console.error('Gemini API error:', geminiError);
                throw new Error(`Gemini API failed: ${geminiError.message}`);
            }
        } else {
            // For PDFs, we need to extract text first
            // This would require PDF parsing - for now, we'll assume text is provided
            const result = await model.generateContent(prompt + fileData);
            const response = await result.response;
            const text = response.text();

            return {
                success: true,
                data: parseGeminiResponse(text),
                processingTime: Date.now() - startTime
            };
        }
    } catch (error) {
        console.error('Gemini analysis error:', error);

        // Return a fallback response if Gemini fails
        const fallbackResponse = {
            summary: {
                english: "AI analysis temporarily unavailable. Please consult your healthcare provider for detailed analysis.",
                urdu: "AI analysis abhi available nahi hai. Detailed analysis ke liye apne doctor se consult karein."
            },
            keyFindings: [],
            recommendations: {
                english: ["Consult with your healthcare provider for detailed analysis"],
                urdu: ["Detailed analysis ke liye apne doctor se consult karein"]
            },
            doctorQuestions: {
                english: ["What do these results mean?", "Do I need any follow-up tests?"],
                urdu: ["Ye results ka matlab kya hai?", "Kya mujhe koi follow-up tests chahiye?"]
            },
            riskFactors: [],
            followUpRequired: true,
            followUpTimeframe: "1-month",
            confidence: 30
        };

        return {
            success: true, // Return success with fallback data
            data: fallbackResponse,
            processingTime: Date.now() - startTime,
            fallback: true
        };
    }
};

// Parse Gemini response and extract JSON
const parseGeminiResponse = (text) => {
    try {
        // Try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        // If no JSON found, create a structured response
        return {
            summary: {
                english: text.substring(0, 500) + "...",
                urdu: "Report ka summary Roman Urdu mein translate karna hai"
            },
            keyFindings: [],
            recommendations: {
                english: ["Consult with your doctor for detailed analysis"],
                urdu: ["Apne doctor se detailed analysis ke liye consult karein"]
            },
            doctorQuestions: {
                english: ["What do these results mean for my health?"],
                urdu: ["Ye results mere health ke liye kya matlab hai?"]
            },
            riskFactors: [],
            followUpRequired: true,
            followUpTimeframe: "1-month",
            confidence: 60
        };
    } catch (error) {
        console.error('JSON parsing error:', error);
        return {
            summary: {
                english: "Unable to parse report. Please consult your doctor.",
                urdu: "Report parse nahi kar sakte. Doctor se consult karein."
            },
            keyFindings: [],
            recommendations: {
                english: ["Consult with your doctor"],
                urdu: ["Doctor se consult karein"]
            },
            doctorQuestions: {
                english: ["Please explain these results"],
                urdu: ["In results ki explanation dijiye"]
            },
            riskFactors: [],
            followUpRequired: true,
            followUpTimeframe: "1-month",
            confidence: 30
        };
    }
};

// Generate health insights from vitals
const analyzeVitals = async (vitalsData) => {
    try {
        const prompt = `Analyze the following health vitals and provide insights:

    Vitals Data: ${JSON.stringify(vitalsData)}

    Provide analysis in this JSON format:
    {
      "overallHealth": "excellent|good|fair|poor",
      "alerts": ["Alert 1", "Alert 2"],
      "trends": {
        "bloodPressure": "improving|stable|worsening",
        "bloodSugar": "improving|stable|worsening",
        "weight": "improving|stable|worsening"
      },
      "recommendations": {
        "english": ["Recommendation 1"],
        "urdu": ["Roman Urdu recommendation 1"]
      },
      "nextCheckup": "suggested timeframe"
    }`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return {
            success: true,
            data: parseGeminiResponse(text)
        };
    } catch (error) {
        console.error('Vitals analysis error:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = {
    analyzeMedicalReport,
    analyzeVitals,
    model
};
