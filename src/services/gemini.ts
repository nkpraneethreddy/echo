export async function generateInterpretation(text: string, type: 'poem' | 'quote', age?: string, gender?: string) {
  const res = await fetch('/api/ai/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, type, age, gender }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Could not generate an interpretation right now.');
  }

  return data?.text || "The night remains silent...";
}


export async function generatePersonalizedPrompt(entries: any[]) {
  const res = await fetch('/api/ai/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Could not generate a personalized prompt.');
  }

  return data?.text?.trim() || null;
}