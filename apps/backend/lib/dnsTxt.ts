import { resolveTxt } from "dns/promises";

export type TxtResolver = (name: string) => Promise<string[]>;

const systemResolver: TxtResolver = async (name) => {
  try {
    // A TXT record can be split into several chunks; they form one string.
    return (await resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
};

let resolver = systemResolver;

export const lookupTxt = (name: string) => resolver(name);

/** Tests replace DNS with a fake zone. */
export function setTxtResolver(fn: TxtResolver | null) {
  resolver = fn ?? systemResolver;
}
