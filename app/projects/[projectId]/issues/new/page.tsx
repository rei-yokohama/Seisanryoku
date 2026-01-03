import { redirect } from "next/navigation";

export default function ProjectIssueNewRedirect({ params }: { params: { projectId: string } }) {
  redirect(`/issue/new?projectId=${encodeURIComponent(params.projectId)}`);
}
