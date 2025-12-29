import { redirect } from "next/navigation";

export default function NewDealRedirect() {
  redirect("/crm/deals/new");
}
