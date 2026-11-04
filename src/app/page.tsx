import { redirect } from "next/navigation";

// The inbox lives at /meetings; the root only forwards there.
export default function Home() {
  redirect("/meetings");
}
