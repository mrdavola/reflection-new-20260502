import { z } from "zod";
import {
  ExitTicketQuestionGeminiSchema,
  ExitTicketTurnGeminiSchema,
  generateGeminiImage,
  generateGeminiStructured,
  generateGeminiText,
  ReflectionAnalysisGeminiSchema,
  SafetyAlertsGeminiSchema,
  StepAnalysisGeminiSchema,
  type GeminiSchema,
} from "./gemini";
import {
  ExitTicketQuestionSchema,
  ExitTicketTurnAnalysisSchema,
  ReflectionAnalysisSchema,
  StepAnalysisSchema,
  type ExitTicketQuestion,
  type ExitTicketTurnAnalysis,
  type ReflectionAnalysis,
  type StepAnalysis,
} from "./schemas";
import type { Reflection, Session } from "@/lib/models";
import { getRoutineStep } from "@/lib/routines";
import { classifyTranscriptSafety } from "@/lib/safety";
import type { RoutineStepLabel, SafetyAlert } from "@/lib/types";
import { hasGeminiEnv } from "@/lib/server/env";

const GEMINI_ANALYSIS_MODEL = process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-flash-latest";
const GEMINI_TRANSCRIPTION_MODEL =
  process.env.GEMINI_TRANSCRIPTION_MODEL ?? GEMINI_ANALYSIS_MODEL;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";

function getGeminiApiKey() {
  if (!hasGeminiEnv()) return null;
  return process.env.GEMINI_API_KEY ?? null;
}

export async function transcribeAudio(file: File) {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    return "I see important details, I think they connect to the lesson, and I wonder what evidence would help us learn more.";
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const transcript = await generateGeminiText({
      apiKey: geminiApiKey,
      model: GEMINI_TRANSCRIPTION_MODEL,
      system:
        "You transcribe student classroom audio. Return only the student's spoken words as plain text. Do not summarize or add labels.",
      parts: [
        {
          inline_data: {
            mime_type: file.type || "audio/webm",
            data: buffer.toString("base64"),
          },
        },
        { text: "Generate a transcript of the speech." },
      ],
    });
    return transcript;
  } catch (error) {
    console.warn("Gemini transcription failed, falling back.", error);
    return "I see important details, I think they connect to the lesson, and I wonder what evidence would help us learn more.";
  }
}

export async function moderateTranscript(transcript: string) {
  const heuristic = classifyTranscriptSafety(transcript);
  const alerts: SafetyAlert[] = heuristic ? [heuristic] : [];
  const geminiApiKey = getGeminiApiKey();

  if (!geminiApiKey) return alerts;

  try {
    const geminiResult = await generateGeminiStructured({
      apiKey: geminiApiKey,
      model: GEMINI_ANALYSIS_MODEL,
      system:
        "You classify student reflection transcripts for teacher review. Only create alerts for personal safety, self-harm, abuse, violence, threats, profanity, unusually negative tone, or very low engagement. Do not punish students. When in doubt, return no alerts.",
      prompt: `Student transcript:\n${transcript}`,
      schema: SafetyAlertsGeminiSchema,
      parse: SafetyAlertsSchema.parse,
    });
    for (const alert of geminiResult.alerts) {
      if (
        !alerts.some(
          (existing) =>
            existing.severity === alert.severity &&
            existing.category === alert.category,
        )
      ) {
        alerts.push({
          severity: alert.severity,
          category: alert.category,
          title: alert.title,
          message: alert.message,
          matchedText: alert.matchedText ?? undefined,
        });
      }
    }
  } catch (error) {
    console.warn("Gemini safety classification failed, using heuristic alerts.", error);
  }

  return alerts;
}

export async function analyzeStep(input: {
  session: Session;
  label: RoutineStepLabel;
  transcript: string;
  previousTranscripts?: string[];
}) {
  const step = getRoutineStep(labelToNumber(input.label, input.session.routineId), input.session.routineId);
  const geminiApiKey = getGeminiApiKey();
  const isIUTT = input.session.routineId === "i-used-to-think";
  const isCSQ = input.session.routineId === "claim-support-question";
  const isWYR = input.session.routineId === "would-you-rather";

  if (geminiApiKey) {
    try {
      const promptLines = isWYR
        ? [
            "Routine: Would You Rather",
            `Step: ${step.label}`,
            `Learning target: ${input.session.learningTarget || "Not provided"}`,
            input.label === "Reasoning"
              ? input.previousTranscripts?.[0]
                ? `Student's choice: ${input.previousTranscripts[0]}`
                : null
              : null,
            `Student response: ${input.transcript}`,
            input.label === "Choice"
              ? "This is a choice selection. Score how clearly they selected an option (1=unclear, 4=clear). Generate a follow-up asking them to explain their reasoning."
              : "Score how well they justify their choice (1=weak reasoning, 4=clear reasoning with evidence). Generate a follow-up that pushes for deeper reasoning if needed.",
            "Use an integer depthScore from 1 to 4.",
          ].filter(Boolean).join("\n")
        : isIUTT
        ? [
            "Routine: I Used to Think… Now I Think",
            `Step: ${step.label}`,
            `What was taught: ${input.session.learningTarget || "Not provided"}`,
            input.label === "Now I Think" && input.previousTranscripts?.[0]
              ? `Student's prior belief (Used to Think): ${input.previousTranscripts[0]}`
              : null,
            `Student response: ${input.transcript}`,
            input.label === "Used to Think"
              ? "Score how specific and honest the prior belief is (1=vague, 4=precise misconception or detailed prior model). Generate one follow-up that asks for more detail about the prior belief if vague."
              : "Score how clearly the student articulates what shifted and why (1=vague 'I understand better now', 4=names the specific idea/evidence that changed their thinking). If they haven't named what caused the shift, ask them to identify it, quoting their 'Used to Think' response.",
            "Use an integer depthScore from 1 to 4.",
          ].filter(Boolean).join("\n")
        : isCSQ
          ? [
              "Routine: Claim Support Question",
              `Step: ${step.label}`,
              `Learning target: ${input.session.learningTarget || "Not provided"}`,
              input.previousTranscripts?.length
                ? `Previous steps: ${input.previousTranscripts.join(" | ")}`
                : null,
              `Student response: ${input.transcript}`,
              input.label === "Claim"
                ? "Score how clear and debatable the claim is (1=just restates a fact, 4=clear arguable position). Ask a follow-up to sharpen the claim if it's vague or just factual."
                : input.label === "Support"
                  ? "Score how strong and specific the evidence is (1=opinion only, 4=concrete example with clear link to the claim). Ask a follow-up to make the evidence more specific if needed."
                  : "Score how genuinely curious and investigable the question is (1=yes/no question, 4=open investigable question that connects to the claim). Push toward a more open question if needed.",
              "Use an integer depthScore from 1 to 4.",
            ].filter(Boolean).join("\n")
          : [
              "Routine: See Think Wonder",
              `Step: ${step.label}`,
              `Step prompt: ${step.prompt}`,
              `Learning target: ${input.session.learningTarget || "Not provided"}`,
              `Student transcript: ${input.transcript}`,
              "Score thinking depth from 1 surface to 4 transfer. Generate at most one follow-up question that stays inside this routine step.",
              "Use an integer depthScore from 1 to 4.",
            ].join("\n");

      return await generateGeminiStructured({
        apiKey: geminiApiKey,
        model: GEMINI_ANALYSIS_MODEL,
        system:
          "You analyze K-12 student reflection. Be warm, specific, and never shame the student.",
        prompt: promptLines,
        schema: StepAnalysisGeminiSchema,
        parse: StepAnalysisSchema.parse,
      });
    } catch (error) {
      console.warn("Gemini step analysis failed, falling back.", error);
    }
  }

  return heuristicStepAnalysis(input.transcript, input.label);
}

export async function analyzeCompletedReflection(reflection: Reflection) {
  const geminiApiKey = getGeminiApiKey();

  if (geminiApiKey) {
    try {
      return await generateGeminiStructured({
        apiKey: geminiApiKey,
        model: GEMINI_ANALYSIS_MODEL,
        system:
          "You create concise student-facing feedback for grades 3-5 reflection. Feedback must be specific, encouraging, and include exactly one nudge.",
        prompt: `Analyze this completed reflection:\n${reflection.steps
          .map((step) => `${step.label}: ${step.transcription}`)
          .join("\n")}\n\nUse integer overallDepthScore from 1 to 4.`,
        schema: ReflectionAnalysisGeminiSchema,
        parse: ReflectionAnalysisSchema.parse,
      });
    } catch (error) {
      console.warn("Gemini reflection analysis failed, falling back.", error);
    }
  }

  return heuristicReflectionAnalysis(reflection);
}

export async function generateSessionSummary(input: {
  session: Session;
  reflections: Reflection[];
}) {
  const geminiApiKey = getGeminiApiKey();
  const completed = input.reflections.filter((reflection) => reflection.completedAt);

  if (!geminiApiKey) {
    return heuristicClassSummary(completed);
  }

  try {
    return await generateGeminiText({
      apiKey: geminiApiKey,
      model: GEMINI_ANALYSIS_MODEL,
      system:
        "Summarize class thinking for a teacher. Paragraph 1: what students are thinking. Paragraph 2: what the teacher should do next. Be specific and actionable.",
      parts: [
        {
          text: [
          `Learning target: ${input.session.learningTarget || "Not provided"}`,
          `Thinking map: ${JSON.stringify(input.session.classThinkingMap)}`,
          `Student responses: ${completed
            .map((reflection) =>
              `${reflection.displayName}: ${reflection.steps
                .map((step) => `${step.label}: ${step.transcription}`)
                .join(" | ")}`,
            )
            .join("\n")}`,
          ].join("\n\n"),
        },
      ],
    });
  } catch (error) {
    console.warn("Gemini class summary failed, falling back.", error);
    return heuristicClassSummary(completed);
  }
}

export async function generateStimulusImage(input: {
  prompt: string;
  learningTarget?: string;
}) {
  const geminiApiKey = getGeminiApiKey();
  const prompt = [
    "Create a classroom-safe image for a grades 3-5 See Think Wonder routine.",
    "The image should be visually rich enough for observation, interpretation, and curiosity.",
    "No readable text, no logos, no copyrighted characters, no frightening content.",
    input.learningTarget ? `Learning target: ${input.learningTarget}` : null,
    `Teacher description: ${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!geminiApiKey) {
    return {
      dataUrl: fallbackStimulusDataUrl(input.prompt),
      revisedPrompt: prompt,
      model: "local-fallback",
    };
  }

  try {
    const image = await generateGeminiImage({
      apiKey: geminiApiKey,
      model: GEMINI_IMAGE_MODEL,
      prompt,
    });

    return {
      dataUrl: `data:${image.mimeType};base64,${image.data}`,
      revisedPrompt: prompt,
      model: GEMINI_IMAGE_MODEL,
    };
  } catch (error) {
    if (geminiApiKey) {
      throw error;
    }

    console.warn("Gemini image generation failed, falling back.", error);
    return {
      dataUrl: fallbackStimulusDataUrl(input.prompt),
      revisedPrompt: prompt,
      model: "local-fallback",
    };
  }
}

const StimulusPromptSuggestionsGeminiSchema: GeminiSchema = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["title", "description", "prompt"],
        propertyOrdering: ["title", "description", "prompt"],
      },
    },
  },
  required: ["suggestions"],
  propertyOrdering: ["suggestions"],
};

export type StimulusPromptSuggestion = {
  title: string;
  description: string;
  prompt: string;
};

export async function generateStimulusPromptSuggestions(input: {
  learningTarget: string;
  gradeBand?: string;
  subject?: string;
}): Promise<StimulusPromptSuggestion[]> {
  const geminiApiKey = getGeminiApiKey();

  if (geminiApiKey) {
    try {
      const result = await generateGeminiStructured({
        apiKey: geminiApiKey,
        model: GEMINI_ANALYSIS_MODEL,
        system:
          "You suggest three distinct image prompts for a classroom See Think Wonder visual thinking routine. Each suggestion must work well for student observation, interpretation, and questioning. Images must be classroom-safe, contain no readable text, no people, no logos, and be appropriate for the specified grade level.",
        prompt: [
          `Learning target: ${input.learningTarget}`,
          input.gradeBand ? `Grade band: ${input.gradeBand}` : null,
          input.subject ? `Subject area: ${input.subject}` : null,
          "Generate exactly 3 suggestions. Make them meaningfully different: e.g. a close-up detail scene, a wide contextual scene, and a conceptual or metaphorical scene.",
          "Each needs: title (3-5 words), description (one teacher-facing sentence explaining why this works), and prompt (a detailed image generation prompt that produces a visually rich, classroom-safe scene with no readable text).",
        ]
          .filter(Boolean)
          .join("\n"),
        schema: StimulusPromptSuggestionsGeminiSchema,
        parse: (val) =>
          (val as { suggestions: StimulusPromptSuggestion[] }).suggestions,
      });
      return result;
    } catch (error) {
      console.warn("Gemini stimulus suggestions failed, falling back.", error);
    }
  }

  return [
    {
      title: "Classroom observation scene",
      description: "A rich scene with objects connected to the learning target for close observation.",
      prompt: `A classroom-safe, detailed visual scene connected to: ${input.learningTarget}. Rich in observable details. No text, no people, no logos.`,
    },
    {
      title: "Close-up details",
      description: "A tight close-up revealing fine textures and patterns students can examine carefully.",
      prompt: `A detailed close-up of objects or phenomena related to: ${input.learningTarget}. Many small details for students to notice. No text, no people.`,
    },
    {
      title: "Real-world context",
      description: "A real-world setting that connects the concept to everyday life.",
      prompt: `A real-world outdoor or community scene illustrating: ${input.learningTarget}. Visually rich, student-friendly. No text, no people.`,
    },
  ];
}

export async function generateExitTicketQuestion(input: {
  subject: string;
  gradeBand: string;
  lessonContext: string;
}): Promise<ExitTicketQuestion> {
  const geminiApiKey = getGeminiApiKey();

  if (geminiApiKey) {
    try {
      return await generateGeminiStructured({
        apiKey: geminiApiKey,
        model: GEMINI_ANALYSIS_MODEL,
        system:
          "You write one reflection-forward exit ticket question for a teacher. It must be open-ended, grade-appropriate, and invite evidence or reasoning.",
        prompt: [
          `Subject: ${input.subject}`,
          `Grade: ${input.gradeBand}`,
          `What was taught: ${input.lessonContext}`,
          "Return one question only, plus a short teacher-facing rationale.",
        ].join("\n"),
        schema: ExitTicketQuestionGeminiSchema,
        parse: ExitTicketQuestionSchema.parse,
      });
    } catch (error) {
      console.warn("Gemini exit ticket question failed, falling back.", error);
    }
  }

  return heuristicExitTicketQuestion(input);
}

export async function analyzeExitTicketTurn(input: {
  session: Session;
  reflection: Reflection;
  prompt: string;
  response: string;
  turnIndex: number;
  maxTurns: number;
}): Promise<ExitTicketTurnAnalysis> {
  const previous = input.reflection.steps
    .map((step) => `${step.prompt ?? step.label}: ${step.transcription}`)
    .join("\n");
  const geminiApiKey = getGeminiApiKey();

  if (geminiApiKey) {
    try {
      const analysis = await generateGeminiStructured({
        apiKey: geminiApiKey,
        model: GEMINI_ANALYSIS_MODEL,
        system:
          "You analyze one student reflection turn for a K-12 teacher. Always quote the student's exact words, rate depth from 1 surface to 4 transfer, and generate one specific follow-up unless this is the final turn. The follow-up must stay inside the teacher's lesson topic, use the lesson vocabulary, and feel like a warm teacher noticing the student's words.",
        prompt: buildExitTicketTurnPrompt({
          session: input.session,
          prompt: input.prompt,
          response: input.response,
          previous: previous || "None",
          turnIndex: input.turnIndex,
          maxTurns: input.maxTurns,
        }),
        schema: ExitTicketTurnGeminiSchema,
        parse: ExitTicketTurnAnalysisSchema.parse,
      });
      return enforceTopicBoundExitTicketAnalysis(analysis, input);
    } catch (error) {
      console.warn("Gemini exit ticket turn failed, falling back.", error);
    }
  }

  return enforceTopicBoundExitTicketAnalysis(heuristicExitTicketTurn(input), input);
}

export function buildExitTicketTurnPrompt(input: {
  session: Session;
  prompt: string;
  response: string;
  previous: string;
  turnIndex: number;
  maxTurns: number;
}) {
  const lessonContext =
    input.session.exitTicketContext ||
    input.session.learningTarget ||
    input.session.exitTicketQuestion ||
    "today's lesson";

  return [
    `Exit ticket question: ${input.session.exitTicketQuestion}`,
    `Lesson context: ${lessonContext}`,
    `Current prompt: ${input.prompt}`,
    `Student response: ${input.response}`,
    `Previous conversation:\n${input.previous || "None"}`,
    `Turn ${input.turnIndex + 1} of ${input.maxTurns}.`,
    "Use an integer rating from 1 to 4.",
    "Topic lock: The next follow-up must stay inside the lesson context above. Use vocabulary from the lesson context, current prompt, or student's exact words. Do not introduce new concepts, mechanisms, examples, or analogies that the teacher did not provide.",
    "If the student says they are unsure, ask a simpler lesson-connected question instead of changing topics.",
    "For example, if the lesson context is the water cycle and the student mentions precipitation or raindrops, ask about water-cycle ideas like evaporation, condensation, precipitation, collection, clouds, or water vapor. Do not pivot to gravity or energy unless the teacher's context or the student's words already named them.",
    input.turnIndex >= input.maxTurns - 1
      ? "This is the final turn. Set followUpQuestion to null."
      : "Write one short follow-up question, ideally under 28 words. It must include a direct quote from the student's current response and ask them to deepen, clarify, connect, or provide evidence about the teacher's topic.",
  ].join("\n\n");
}

export function enforceTopicBoundExitTicketAnalysis(
  analysis: ExitTicketTurnAnalysis,
  input: {
    session: Session;
    response: string;
    turnIndex: number;
    maxTurns: number;
  },
): ExitTicketTurnAnalysis {
  if (!analysis.followUpQuestion || input.turnIndex >= input.maxTurns - 1) {
    return {
      ...analysis,
      followUpQuestion: input.turnIndex >= input.maxTurns - 1 ? null : analysis.followUpQuestion,
    };
  }

  const lessonText = [
    input.session.exitTicketQuestion,
    input.session.exitTicketContext,
    input.session.learningTarget,
    input.response,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const followUp = analysis.followUpQuestion.toLowerCase();
  const awkwardQuote = /\byou(?:'re| are)\s+["“]/i.test(
    analysis.followUpQuestion,
  );
  const offTopicTerms = [
    "gravity",
    "energy",
    "force",
    "friction",
    "magnet",
    "electricity",
    "photosynthesis",
    "atom",
  ];
  const introducedOffTopic = offTopicTerms.some(
    (term) => followUp.includes(term) && !lessonText.includes(term),
  );

  if (!introducedOffTopic && !awkwardQuote && analysis.followUpQuestion.length <= 240) {
    return analysis;
  }

  return {
    ...analysis,
    followUpQuestion: buildTopicRecoveryFollowUp({
      session: input.session,
      quote: analysis.directQuote || extractQuote(input.response),
    }),
  };
}

function buildTopicRecoveryFollowUp(input: {
  session: Session;
  quote: string;
}) {
  const context = [
    input.session.exitTicketContext,
    input.session.learningTarget,
    input.session.exitTicketQuestion,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const quote = input.quote.trim() || "I'm not sure";

  if (context.includes("water cycle")) {
    return `You said "${quote}." Thinking about the water cycle, which step connects most to your idea, and what makes you say that?`;
  }

  const lessonName =
    input.session.exitTicketContext ||
    input.session.learningTarget ||
    "today's lesson";
  return `You said "${quote}." Thinking about ${lessonName}, what lesson detail could help explain your idea?`;
}

const SafetyAlertsSchema = z.object({
  alerts: z.array(
    z.object({
      severity: z.enum(["amber", "red"]),
      category: z.enum([
        "personal_safety",
        "self_harm",
        "violence",
        "abuse",
        "threat",
        "profanity",
        "low_depth",
        "negative_tone",
      ]),
      title: z.string().min(1),
      message: z.string().min(1),
      matchedText: z.string().nullable().optional(),
    }),
  ),
});

function heuristicStepAnalysis(transcript: string, label: RoutineStepLabel): StepAnalysis {
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const hasReasoning = /\b(because|so|since|that makes me think|evidence|maybe|might)\b/i.test(
    transcript,
  );
  const hasQuestion = /\?|wonder|why|how|what if|could/i.test(transcript);
  const depthScore = Math.min(4, Math.max(1, (words > 18 ? 2 : 1) + (hasReasoning ? 1 : 0) + (hasQuestion ? 1 : 0)));
  const depthLevel = (["surface", "developing", "deep", "transfer"] as const)[
    depthScore - 1
  ];

  return StepAnalysisSchema.parse({
    depthLevel,
    depthScore,
    cognitiveMoves: [
      label === "See" ? "observed details" : null,
      hasReasoning ? "explained reasoning" : null,
      hasQuestion ? "asked a question" : null,
    ].filter(Boolean),
    specificEvidence:
      transcript.length > 120 ? `${transcript.slice(0, 117)}...` : transcript,
    followUpQuestion: buildFollowUp(label, transcript),
    tone: "engaged",
    safetyNotes: null,
  });
}

function fallbackStimulusDataUrl(prompt: string) {
  const safePrompt = escapeXml(prompt.trim() || "Classroom observation scene");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
  <rect width="1536" height="1024" fill="#fdcb40"/>
  <rect x="96" y="88" width="1344" height="848" rx="48" fill="#fff6ed" stroke="#000" stroke-width="8"/>
  <circle cx="342" cy="300" r="118" fill="#04c6c5" stroke="#000" stroke-width="8"/>
  <rect x="524" y="214" width="606" height="190" rx="46" fill="#fff" stroke="#000" stroke-width="8"/>
  <path d="M280 678 C430 502, 650 508, 812 660 S1134 808, 1278 620" fill="none" stroke="#006cff" stroke-width="24" stroke-linecap="round"/>
  <rect x="246" y="702" width="300" height="116" rx="34" fill="#f780d4" stroke="#000" stroke-width="8"/>
  <rect x="660" y="706" width="246" height="116" rx="34" fill="#00b351" stroke="#000" stroke-width="8"/>
  <rect x="1012" y="690" width="278" height="132" rx="34" fill="#fd4401" stroke="#000" stroke-width="8"/>
  <text x="768" y="512" text-anchor="middle" font-family="Arial, sans-serif" font-size="58" font-weight="800" fill="#000">AI image preview</text>
  <text x="768" y="584" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#000">${safePrompt.slice(0, 70)}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function heuristicExitTicketQuestion(input: {
  subject: string;
  gradeBand: string;
  lessonContext: string;
}): ExitTicketQuestion {
  const subject = input.subject.trim() || "today's lesson";
  const context = input.lessonContext.trim() || `what you learned in ${subject}`;

  return ExitTicketQuestionSchema.parse({
    question: `What is one idea from ${context} that feels important to you now, and what makes you say that?`,
    rationale:
      "This asks students to name a meaningful idea and support it with reasoning or evidence.",
  });
}

function heuristicExitTicketTurn(input: {
  response: string;
  turnIndex: number;
  maxTurns: number;
}): ExitTicketTurnAnalysis {
  const words = input.response.split(/\s+/).filter(Boolean).length;
  const hasReasoning = /\b(because|so|since|evidence|example|when|if|means)\b/i.test(
    input.response,
  );
  const hasTransfer = /\b(another|outside|real life|reminds me|different subject|next time)\b/i.test(
    input.response,
  );
  const rating = Math.min(4, Math.max(1, (words > 12 ? 2 : 1) + (hasReasoning ? 1 : 0) + (hasTransfer ? 1 : 0)));
  const ratingLabel = (["surface", "developing", "deep", "transfer"] as const)[rating - 1];
  const quote = extractQuote(input.response);

  return ExitTicketTurnAnalysisSchema.parse({
    directQuote: quote,
    rating,
    ratingLabel,
    teacherSummary:
      rating >= 3
        ? "The student is explaining their thinking with evidence or a meaningful connection."
        : "The student has started a reflection but needs a more specific reason or example.",
    followUpQuestion:
      input.turnIndex >= input.maxTurns - 1
        ? null
        : `That is an interesting thought! Can you share a specific example or detail from class that supports your idea?`,
  });
}

function heuristicReflectionAnalysis(reflection: Reflection): ReflectionAnalysis {
  const highestStep =
    reflection.steps
      .slice()
      .sort((a, b) => (b.depthScore ?? 1) - (a.depthScore ?? 1))[0] ?? reflection.steps[0];
  const average =
    reflection.steps.reduce((sum, step) => sum + (step.depthScore ?? 1), 0) /
    Math.max(reflection.steps.length, 1);

  return ReflectionAnalysisSchema.parse({
    overallDepthScore: Math.round(average),
    strongestStep: highestStep?.label ?? "Wonder",
    strongestMove: `Your ${highestStep?.label ?? "Wonder"} response used a specific idea from your thinking.`,
    nudge: "Next time, add one exact detail as evidence for your idea.",
    keyQuotes: reflection.steps
      .map((step) => step.transcription)
      .filter(Boolean)
      .slice(0, 2),
    crossCurricularConnections: detectConnections(reflection),
    mindset: "growth",
    tone: reflection.contentAlerts.some((alert) => alert.severity === "red")
      ? "concerned"
      : "engaged",
  });
}

function heuristicClassSummary(reflections: Reflection[]) {
  if (reflections.length === 0) {
    return "No completed reflections yet. Once students finish, ReflectAI will summarize class patterns and suggest next instructional moves.";
  }

  return `Students are producing visible thinking across ${reflections.length} completed reflections. The strongest pattern is that students are naming observable details and beginning to explain what those details might mean.\n\nNext, ask two or three students to share one claim and the exact detail that supports it. Then use “What makes you say that?” as a whole-class bridge before moving into writing.`;
}

function buildFollowUp(label: RoutineStepLabel, transcript: string) {
  if (label === "See") return "What is one smaller detail you noticed that others might miss?";
  if (label === "Think") return "What detail from what you saw makes you think that?";
  if (label === "Claim") return "Could someone disagree with your claim? What would they say?";
  if (label === "Support") return "What is the strongest piece of evidence you have for your claim?";
  if (label === "Question") return "What would you need to find out to answer that question?";
  if (transcript.length < 40) return "What makes that question important to investigate?";
  return "Where could you look for evidence to explore that question?";
}

function extractQuote(response: string) {
  const trimmed = response.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 90) return trimmed;

  const sentence = trimmed.split(/[.!?]/).find((item) => item.trim().length > 0);
  return (sentence && sentence.length <= 90 ? sentence : trimmed.slice(0, 87)).trim() + "...";
}

function detectConnections(reflection: Reflection) {
  const text = reflection.steps.map((step) => step.transcription).join(" ").toLowerCase();
  return [
    /map|place|country|city|history/.test(text) ? "Social studies" : null,
    /weather|water|plant|animal|data/.test(text) ? "Science" : null,
    /number|pattern|graph|measure/.test(text) ? "Math" : null,
  ].filter(Boolean) as string[];
}

function labelToNumber(label: RoutineStepLabel, routineId?: string) {
  if (routineId === "i-used-to-think") {
    return label === "Used to Think" ? 1 : 2;
  }
  if (routineId === "would-you-rather") {
    return label === "Choice" ? 1 : 2;
  }
  if (routineId === "claim-support-question") {
    return label === "Claim" ? 1 : label === "Support" ? 2 : 3;
  }
  return label === "See" ? 1 : label === "Think" ? 2 : 3;
}
