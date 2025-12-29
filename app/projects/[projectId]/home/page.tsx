import { redirect } from "next/navigation";

export default function ProjectHomeRedirectPage({ params }: { params: { projectId: string } }) {
  redirect(`/dashboard?projectId=${encodeURIComponent(params.projectId)}`);
}


