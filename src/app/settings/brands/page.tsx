import type { Metadata } from "next";
import { BrandKitsView } from "@/components/studio/settings/brand-kits";

export const metadata: Metadata = { title: "Brand kits" };

export default function BrandKitsPage() {
  return <BrandKitsView />;
}
