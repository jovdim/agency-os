import { redirect } from "next/navigation";

/**
 * /sales/contacts was the old "contacts with any proposal" list view.
 * It has been retired — Active (/sales/active) now surfaces every
 * contact that's in motion (non-terminal call_log latest OR any open
 * proposal). Keep this file as a redirect so existing bookmarks /
 * inbound links don't 404.
 *
 * The /sales/contacts/[id] detail page and /sales/contacts/new flow
 * are still live — they sit under this route segment but are not
 * affected by this redirect (Next routes more-specific segments first).
 */
export default function ContactsListRedirect() {
  redirect("/sales/active");
}
