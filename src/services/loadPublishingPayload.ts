import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { supabase } from "../supabase.js";
import { PublisherError, parsePostOptions, type PostKind, type PostOptions } from "../types/publishing.js";
import type { PublishingJob } from "../queue.js";

interface ContentRow {
  id: string;
  caption: string | null;
  hashtags: string[] | null;
  content_type: string;
}

interface MediaAssetRow {
  id: string;
  file_name: string;
  file_url: string;
  file_type: "image" | "video";
  asset_role: "main" | "cover" | "attachment";
  created_at: string;
}

async function downloadToTempFile(fileUrl: string, fileName: string, jobDir: string): Promise<string> {
  const response = await fetch(fileUrl).catch(() => undefined);

  if (!response || !response.ok) {
    throw new PublisherError("MEDIA_FILE_NOT_FOUND", `Impossibile scaricare il media "${fileName}" da Supabase Storage.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = path.join(jobDir, safeName);
  await fsPromises.writeFile(localPath, buffer);
  return localPath;
}

function mapContentTypeToKind(contentType: string, mediaCount: number): PostKind {
  if (contentType === "video" || contentType === "reel") return "video";
  if (contentType === "carousel") return "carousel";
  if (contentType === "post") return mediaCount >= 2 ? "carousel" : "photo";

  throw new PublisherError(
    "INVALID_JOB_OPTIONS",
    `content_type "${contentType}" non è supportato dalla pubblicazione automatica (story/live non gestiti).`
  );
}

/**
 * Costruisce i PostOptions per publishMediaPost() leggendo direttamente
 * contents / media_assets / content_platforms su Supabase (nessuna route
 * API, nessuna server action Next.js: il worker interroga il DB condiviso).
 */
export async function loadPublishingPayload(job: PublishingJob): Promise<PostOptions> {
  if (!job.content_id) {
    throw new PublisherError("INVALID_JOB_OPTIONS", "Il job non ha un content_id associato.");
  }

  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, caption, hashtags, content_type")
    .eq("id", job.content_id)
    .single();

  if (contentError || !content) {
    throw new PublisherError("INVALID_JOB_OPTIONS", `Contenuto non trovato per content_id ${job.content_id}.`);
  }

  const contentRow = content as ContentRow;

  if (job.platform) {
    const { data: platformRow, error: platformError } = await supabase
      .from("content_platforms")
      .select("id")
      .eq("content_id", job.content_id)
      .eq("platform", job.platform)
      .maybeSingle();

    if (platformError || !platformRow) {
      throw new PublisherError(
        "INVALID_JOB_OPTIONS",
        `Il contenuto non è abilitato per la piattaforma "${job.platform}".`
      );
    }
  }

  const { data: assets, error: assetsError } = await supabase
    .from("media_assets")
    .select("id, file_name, file_url, file_type, asset_role, created_at")
    .eq("content_id", job.content_id)
    .order("created_at", { ascending: true });

  if (assetsError || !assets || assets.length === 0) {
    throw new PublisherError("MEDIA_FILE_NOT_FOUND", `Nessun media trovato per content_id ${job.content_id}.`);
  }

  const typedAssets = assets as MediaAssetRow[];
  const mainAssets = typedAssets.filter((a) => a.asset_role === "main");
  const attachments = typedAssets.filter((a) => a.asset_role === "attachment");
  const coverAssets = typedAssets.filter((a) => a.asset_role === "cover");

  const orderedMedia = [...mainAssets, ...attachments];
  if (orderedMedia.length === 0) {
    throw new PublisherError("MEDIA_FILE_NOT_FOUND", `Nessun media "main" trovato per content_id ${job.content_id}.`);
  }

  const kind = mapContentTypeToKind(contentRow.content_type, orderedMedia.length);

  const jobDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), `publishing-${job.id}-`));

  const mediaPaths = await Promise.all(
    orderedMedia.map((asset) => downloadToTempFile(asset.file_url, asset.file_name, jobDir))
  );

  const coverPath =
    kind === "video" && coverAssets[0]
      ? await downloadToTempFile(coverAssets[0].file_url, coverAssets[0].file_name, jobDir)
      : undefined;

  const caption = [contentRow.caption, contentRow.hashtags?.length ? contentRow.hashtags.join(" ") : undefined]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  return parsePostOptions({
    kind,
    mediaPaths,
    coverPath,
    caption: caption || undefined,
  });
}
