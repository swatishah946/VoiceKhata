import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch'; 

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is missing');
  }

  const formData = new FormData();
  formData.append('file', fs.createReadStream(audioFilePath));
  // Groq provides incredibly fast and free access to the powerful Whisper Large V3 model
  formData.append('model', 'whisper-large-v3-turbo'); 
  formData.append('language', 'hi'); // Hindi/Hinglish
  formData.append('response_format', 'json');

  try {
    // Groq's API is 100% compatible with OpenAI's API format!
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: formData as any
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error: ${response.statusText} - ${errText}`);
    }

    const data: any = await response.json();
    return data.text;
  } catch (error) {
    console.error('Error in Groq Whisper transcription:', error);
    throw error;
  }
}
