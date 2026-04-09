import { getRepository } from "@/lib/persistence/repositories";
import type { PageEntity } from "./types";

const repo = getRepository();

export const allPages: PageEntity[] = await repo.getPages();
