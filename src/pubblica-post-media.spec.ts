import { test } from "@playwright/test";
import { publishMediaPost } from "./publishers/playwrightPublisher.js";
import type { PostOptions } from "./types/publishing.js";

// Cambia lo scenario qui sotto per provare foto / carosello / video.
const postToPublish: PostOptions = {
  kind: "video",
  mediaPaths: ["media/video-post.mp4"],
  coverPath: "media/copertina-video.jpg",
  caption: "Post di prova con un video",
  location: "Milano",
  altText: "Descrizione accessibile del video",
};

test("creazione parametrica di un post", async () => {
  await publishMediaPost("spec-test", postToPublish, "spec-test-account");
});
