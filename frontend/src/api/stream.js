import { getToken } from "./client.js";

const BASE = import.meta.env.VITE_API_URL || "/api";

/**
 * POST to an SSE tutor endpoint and dispatch parsed events.
 *
 * @param {string} path                e.g. `/tutor/sessions/5/stream`
 * @param {object|null} body           JSON body (null for regenerate)
 * @param {object} handlers            { onDelta(text), onDone(meta), onMind(payload), onError(msg) }
 * @param {AbortSignal} [signal]       to support a Stop button
 */
export async function streamSSE(path, body, { onDelta, onDone, onMind, onError }, signal) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : "{}",
      signal,
    });
  } catch (e) {
    if (e.name !== "AbortError") onError?.("Couldn't reach the tutor. Please try again.");
    return;
  }

  if (res.status === 402) {
    // Out of AI credits — surface the friendly quota message from the gate.
    try {
      const data = await res.json();
      onError?.(data.message || "You've used today's AI learning credits.");
    } catch {
      onError?.("You've used today's AI learning credits.");
    }
    window.dispatchEvent(new CustomEvent("usage:refresh"));
    return;
  }

  if (!res.ok || !res.body) {
    onError?.("The tutor is briefly unavailable. Please try again.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleFrame(frame, { onDelta, onDone, onMind, onError });
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") onError?.("The connection dropped. Please try again.");
  }
}

function handleFrame(frame, { onDelta, onDone, onMind, onError }) {
  let event = "message";
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return;

  let payload;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  if (event === "delta") onDelta?.(payload.text ?? "");
  else if (event === "done") {
    onDone?.(payload);
    // A chat turn just consumed credits — refresh any mounted meter.
    window.dispatchEvent(new CustomEvent("usage:refresh"));
  }
  else if (event === "mind") onMind?.(payload.mind ?? payload);  // live "tutor's mind" refresh
  else if (event === "error") onError?.(payload.message ?? "Something went wrong.");
}
