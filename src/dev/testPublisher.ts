import { publishMediaPost } from "../publishers/playwrightPublisher.js";
import type { PostOptions } from "../types/publishing.js";

/**
 * Test manuale del publisher, senza passare dalla coda Supabase.
 * Rispetta ENABLE_REAL_PUBLISHING: con il default (false) si ferma
 * alla schermata finale e salva uno screenshot di dry run.
 *
 * Uso: tsx src/dev/testPublisher.ts [photo|carousel|video|video-cover]
 */
const scenarios: Record<string, PostOptions> = {
  photo: {
    kind: "photo",
    mediaPaths: ["media/foto-post.jpg"],
    caption: "Post di prova con una foto",
    location: "Roma",
    altText: "Descrizione accessibile della foto",
  },
  carousel: {
    kind: "carousel",
    mediaPaths: ["media/foto-carosello-1.jpg", "media/foto-carosello-2.jpg"],
    caption: "Post di prova con più immagini",
    location: "Napoli",
    altText: "Descrizione accessibile del carosello",
  },
  video: {
    kind: "video",
    mediaPaths: ["media/video-post.mp4"],
    caption: "Post di prova con un video",
    location: "Milano",
    altText: "Descrizione accessibile del video",
  },
  "video-cover": {
    kind: "video",
    mediaPaths: ["media/video-post.mp4"],
    coverPath: "media/copertina-video.jpg",
    caption: "Post di prova con un video e copertina personalizzata",
    location: "Milano",
    altText: "Descrizione accessibile del video",
  },
};

const scenarioName = process.argv[2] ?? "photo";
const options = scenarios[scenarioName];

if (!options) {
  console.error(`[test] Scenario sconosciuto: ${scenarioName}`);
  console.error(`[test] Scenari disponibili: ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}

const jobId = `manual-${scenarioName}-${Date.now()}`;

console.log(`[test] Eseguo lo scenario "${scenarioName}" (job fittizio: ${jobId})`);

publishMediaPost(jobId, options, async (step) => {
  console.log(`[test] step: ${step}`);
})
  .then((result) => {
    console.log("[test] Risultato:", result);
  })
  .catch((err) => {
    console.error("[test] Errore:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
