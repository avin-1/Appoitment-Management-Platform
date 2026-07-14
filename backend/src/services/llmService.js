const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const modelName = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';

/**
 * Generates a pre-visit summary from patient symptoms.
 * Expected Output: JSON containing urgency_level, chief_complaint, and suggested_questions.
 */
exports.generatePreVisitSummary = async (symptoms) => {
    try {
        const prompt = `
You are a medical AI assistant. Analyze the following patient symptoms.
Provide the output in valid JSON format exactly matching this structure:
{
  "urgency_level": "Low" | "Medium" | "High",
  "chief_complaint": "String summarizing the main issue",
  "suggested_questions": ["Question 1", "Question 2", "Question 3"]
}
Only output the JSON object, nothing else.

Symptoms:
"${symptoms}"
`;

        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are a helpful and clinical medical AI. Output only valid JSON.' },
                { role: 'user', content: prompt }
            ],
            model: modelName,
            temperature: 0.2,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("LLM Pre-Visit Error:", error);
        throw new Error('Failed to generate pre-visit summary');
    }
};

/**
 * Generates a patient-friendly post-visit summary from doctor notes.
 */
exports.generatePostVisitSummary = async (doctorNotes) => {
    try {
        const prompt = `
You are a medical AI assistant. Convert the following clinical notes from a doctor into a patient-friendly summary.
Provide the output in valid JSON format exactly matching this structure:
{
  "patient_friendly_summary": "Clear, jargon-free explanation of the visit and diagnosis",
  "medication_schedule_summary": "Simple text explaining when to take medications (if any)",
  "follow_up_steps": "Actionable next steps for the patient"
}
Only output the JSON object, nothing else.

Doctor Notes:
"${doctorNotes}"
`;

        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are a helpful medical assistant that explains clinical terms simply to patients. Output only valid JSON.' },
                { role: 'user', content: prompt }
            ],
            model: modelName,
            temperature: 0.2,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("LLM Post-Visit Error:", error);
        throw new Error('Failed to generate post-visit summary');
    }
};
