# How this site is built

This document describes kwamina.fyi itself, including the assistant answering questions on it. There is no public page for this material.

kwamina.fyi is Kwamina's personal site: his writing, the Athena work, and his background. It is one of his projects alongside Athena, and the way it is built shows how he architects systems.

The assistant answering questions here is one feature of the site, not the site itself. The published pages remain the source of truth for Kwamina's public work and background; explicitly approved assistant-only notes supply a small set of personal facts and preferences.

## The site at a glance

- Frontend: React and Vite.
- Backend: one Cloudflare Worker serving both the static site and the chat API, with D1 as the conversation database.
- Toolchain: Bun.
- Verification: around 200 tests on every build.

## The assistant's grounding

At build time, the published pages and explicitly approved assistant-only notes are compiled into a versioned grounding corpus. Editing either source updates the assistant in the same deployment.

The assistant's instructions keep claims inside their source boundaries. A technology used in one role is not attributed to another, and metrics retain their documented labels and values.

## Limits

Grounding bounds the assistant's sources, not every sentence it produces. The model can still phrase a documented fact imperfectly.
