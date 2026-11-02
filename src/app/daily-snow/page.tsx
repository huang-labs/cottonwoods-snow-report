import { SectionView } from "@/components/SectionView";
import { sectionMetadata } from "@/lib/metadata";
import { SECTIONS } from "@/lib/sections";

export const metadata = sectionMetadata(SECTIONS.find((s) => s.id === "daily-snow")!);

export default function Page() {
  return <SectionView id="daily-snow" />;
}
