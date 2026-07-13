export type PostKind = "photo" | "carousel" | "video";

export interface PostOptions {
  kind: PostKind;
  mediaPaths: string[];
  coverPath?: string;
  caption?: string;
  location?: string;
  collaborator?: string;
  altText?: string;
  disableComments?: boolean;
}

export interface PublishResult {
  success: boolean;
  finalUrl?: string;
  externalPostId?: string;
  dryRun?: boolean;
}

export type PublishingJobStatus =
  | "pending"
  | "processing"
  | "published"
  | "failed"
  | "cancelled";

export type PublisherErrorCode =
  | "INVALID_JOB_OPTIONS"
  | "MEDIA_FILE_NOT_FOUND"
  | "AUTHENTICATION_FAILED"
  | "UPLOAD_FAILED"
  | "PUBLICATION_FAILED"
  | "UNKNOWN_ERROR";

export class PublisherError extends Error {
  constructor(public readonly code: PublisherErrorCode, message: string) {
    super(message);
    this.name = "PublisherError";
  }
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

/**
 * Trasforma il campo `options` grezzo del job (Record<string, unknown>)
 * in un PostOptions validato. Lancia PublisherError("INVALID_JOB_OPTIONS")
 * se manca qualcosa o i tipi non tornano.
 */
export function parsePostOptions(raw: Record<string, unknown>): PostOptions {
  const { kind, mediaPaths, coverPath, caption, location, collaborator, altText, disableComments } = raw;

  if (kind !== "photo" && kind !== "carousel" && kind !== "video") {
    throw new PublisherError(
      "INVALID_JOB_OPTIONS",
      `options.kind non valido: atteso "photo" | "carousel" | "video", ricevuto ${JSON.stringify(kind)}`
    );
  }

  if (!isNonEmptyStringArray(mediaPaths)) {
    throw new PublisherError(
      "INVALID_JOB_OPTIONS",
      "options.mediaPaths deve essere un array non vuoto di stringhe"
    );
  }

  if (kind === "photo" && mediaPaths.length < 1) {
    throw new PublisherError("INVALID_JOB_OPTIONS", "Il post foto richiede almeno un file");
  }

  if (kind === "carousel" && mediaPaths.length < 2) {
    throw new PublisherError("INVALID_JOB_OPTIONS", "Il carosello richiede almeno due file");
  }

  if (kind === "video" && mediaPaths.length < 1) {
    throw new PublisherError("INVALID_JOB_OPTIONS", "Il post video richiede un file video");
  }

  if (coverPath !== undefined && typeof coverPath !== "string") {
    throw new PublisherError("INVALID_JOB_OPTIONS", "options.coverPath deve essere una stringa");
  }

  if (caption !== undefined && typeof caption !== "string") {
    throw new PublisherError("INVALID_JOB_OPTIONS", "options.caption deve essere una stringa");
  }

  if (location !== undefined && typeof location !== "string") {
    throw new PublisherError("INVALID_JOB_OPTIONS", "options.location deve essere una stringa");
  }

  if (collaborator !== undefined && typeof collaborator !== "string") {
    throw new PublisherError("INVALID_JOB_OPTIONS", "options.collaborator deve essere una stringa");
  }

  if (altText !== undefined && typeof altText !== "string") {
    throw new PublisherError("INVALID_JOB_OPTIONS", "options.altText deve essere una stringa");
  }

  if (disableComments !== undefined && typeof disableComments !== "boolean") {
    throw new PublisherError("INVALID_JOB_OPTIONS", "options.disableComments deve essere un booleano");
  }

  return {
    kind,
    mediaPaths,
    coverPath,
    caption,
    location,
    collaborator,
    altText,
    disableComments,
  };
}
