"use server";

import { redirect } from "vanilla-bean";

const messages = [];

export async function addMessage(form) {
  const text = String(form.get("text") || "").trim();
  if (text) messages.unshift({ text, at: new Date().toLocaleTimeString() });
  redirect("/demo/form");
}

export function getMessages() {
  return messages.slice(0, 10);
}
