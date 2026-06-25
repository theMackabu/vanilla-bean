function vbFill(id: string): void {
  const tpl = document.querySelector<HTMLTemplateElement>('template[data-vb-fill="' + id + '"]');
  const slot = document.querySelector('[data-vb="' + id + '"]');
  if (!tpl || !slot) return;
  slot.replaceChildren(tpl.content);
  slot.removeAttribute("data-fb");
  tpl.remove();
}

export const fillRuntime = "<script>window.__vbFill=" + vbFill.toString() + "</script>";

export const fillChunk = (id: string, contentHtml: string): string =>
  `<template data-vb-fill="${id}">${contentHtml}</template><script>__vbFill(${JSON.stringify(id)})</script>`;

export function tagBoundaries(doc: Document): Element[] {
  const slots = [...doc.querySelectorAll("[data-fb]")];
  slots.forEach((slot, i) => slot.setAttribute("data-vb", String(i)));
  return slots;
}
