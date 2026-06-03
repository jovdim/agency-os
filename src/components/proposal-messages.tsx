"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, AlertTriangle, UserPlus, CheckCircle, MessageSquare } from "lucide-react";
import { toast } from "sonner";

interface Message {
  id: string;
  proposal_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  message_type: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

type MsgMode = "message" | "revision_request";

function timeAgo(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ProposalMessages({
  proposalId,
  currentUserId,
  currentUserRole = "sales",
}: {
  proposalId: string;
  currentUserId: string;
  currentUserRole?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<MsgMode>("message");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages();
  }, [proposalId]);

  // Don't auto-scroll — user controls their view

  async function loadMessages() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), message_type: mode }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to send");
        return;
      }
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setText("");
      if (mode === "revision_request") {
        toast.success("Revision request sent.");
        router.refresh();
      }
      setMode("message");
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function toggleMode(target: MsgMode) {
    setMode(mode === target ? "message" : target);
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Message Tech Team</p>
      </div>
      {/* Messages */}
      <div className="max-h-72 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">
            No messages yet
          </p>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender_id === currentUserId;
            const isRevisionReq = msg.message_type === "revision_request";
            const isClientReq = msg.message_type === "client_request";
            const isAccountCreated = msg.message_type === "account_created";
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}
              >
                <div
                  className={`rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap ${
                    isRevisionReq
                      ? "bg-yellow-50 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-100 border border-yellow-300 dark:border-yellow-800"
                      : isClientReq
                        ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 border border-blue-300 dark:border-blue-800"
                        : isAccountCreated
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-800"
                          : isOwn
                            ? "bg-[#dcf8c6] text-gray-900 dark:bg-[#005c4b] dark:text-gray-100"
                            : "bg-white text-gray-900 border border-gray-200 dark:bg-[#202c33] dark:text-gray-100 dark:border-[#2a3942]"
                  }`}
                >
                  {isRevisionReq && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-yellow-700 dark:text-yellow-300 mb-1">
                      <AlertTriangle className="h-3 w-3" />
                      Revision Request
                    </span>
                  )}
                  {isClientReq && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1">
                      <UserPlus className="h-3 w-3" />
                      Client Account Request
                    </span>
                  )}
                  {isAccountCreated && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 mb-1">
                      <CheckCircle className="h-3 w-3" />
                      Client Account Created
                    </span>
                  )}
                  {msg.message}
                </div>
                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                  {msg.profiles?.full_name} · {timeAgo(msg.created_at)}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-muted/30 px-3 py-2">
        {currentUserRole === "sales" && (
          <div className="flex gap-1.5 mb-1.5">
            <button
              onClick={() => toggleMode("revision_request")}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                mode === "revision_request"
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                  : "text-muted-foreground hover:text-yellow-600"
              }`}
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              {mode === "revision_request" ? "Revision request" : "Mark as revision"}
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "revision_request"
                ? "What does the tech team need to know…"
                : "Write a note or message…"
            }
            rows={1}
            className="text-sm resize-none min-h-[36px] max-h-20 border-0 shadow-none focus-visible:ring-0 p-2 bg-transparent"
          />
          <Button
            size="sm"
            className={`h-9 w-9 p-0 shrink-0 ${
              mode === "revision_request"
                ? "bg-yellow-600 hover:bg-yellow-700"
                : ""
            }`}
            disabled={!text.trim() || sending}
            onClick={sendMessage}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
