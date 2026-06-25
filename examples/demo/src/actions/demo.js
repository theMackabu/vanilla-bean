"use server";

let hits = 0; // module state lives on the server, shared across requests

export async function bump(by = 1) {
  hits += Number(by) || 1;
  return { hits, at: new Date().toISOString(), pid: typeof process !== "undefined" ? process.pid : 0 };
}
