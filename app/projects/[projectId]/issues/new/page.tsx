import { redirect } from "next/navigation";

export default function ProjectIssueNewRedirect({ params }: { params: { projectId: string } }) {
  redirect(`/projects/new?projectId=${encodeURIComponent(params.projectId)}`);
}
