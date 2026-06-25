"use server";

import { cookies, redirect } from "vanilla-bean";

export async function login(name) {
  cookies().set("session", String(name || "guest"), {
    httpOnly: true,
    sameSite: "lax",
  });
  redirect("/demo/auth");
}

export async function logout() {
  cookies().delete("session");
  redirect("/demo/login");
}
