import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { generateAiPlan } from './services/generateAiPlan';

const sampleHackathon = {
  name: "Global AI Innovation Hack",
  theme: "Generative AI for Social Good",
  prize: "$10,000 in cash and AWS credits",
  tags: ["AI", "GenAI", "Social Impact"],
  mode: "online",
  description: "Join us for a 48-hour hackathon focused on building applications that use Generative AI to solve real-world social problems. Whether it is education, healthcare, or sustainability, we want to see your most innovative ideas.",
  deadline: "2026-05-15T23:59:59Z",
  team_size: 4
};

async function runTest() {
  console.log("Starting Ollama test...");
  try {
    const plan = await generateAiPlan(sampleHackathon);
    console.log("AI Plan generated successfully:");
    console.log(JSON.stringify(plan, null, 2));
  } catch (err: any) {
    console.error("Test failed:", err.message);
  }
}

runTest();
