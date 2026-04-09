import { getRepository } from "@/lib/persistence/repositories";
import type { PageSnapshot } from "./types";

const repo = getRepository();

export const pageSnapshots: PageSnapshot[] = await repo.getPageSnapshots();
