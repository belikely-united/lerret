// no-ai.js — stands in for @lerret/ai in the MCP App build. Inside Claude or
// ChatGPT the chat's own model is the designer, so the studio's built-in AI
// (LangGraph, provider SDKs; ~0.9 MB) is left out. ai/lazy.js is the only
// importer; it surfaces this as a normal "AI unavailable" error.
throw new Error('The studio AI is off inside the chat app. Ask the chat instead.');
