// Ollama chat API クライアント。モデル名・ホストは環境変数で切替可能。
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Ollama の /api/chat を JSON モードで呼ぶ。
 * format: "json" を指定すると応答が JSON テキストになる。
 * 失敗時は例外を投げる（呼び出し側でリトライ/フォールバック）。
 */
export async function chatJSON(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number } = {},
): Promise<string> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? OLLAMA_MODEL,
      messages,
      stream: false,
      format: "json",
      options: {
        temperature: opts.temperature ?? 0.8,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama returned empty content");
  return content;
}

/** Ollama に疎通できるか（起動確認用） */
export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}
