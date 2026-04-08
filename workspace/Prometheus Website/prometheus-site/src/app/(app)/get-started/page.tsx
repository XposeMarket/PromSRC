"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

interface Step {
  id: number;
  title: string;
  description: string;
  details: string[];
  action: { label: string; href: string };
}

const steps: Step[] = [
  {
    id: 1,
    title: "Set up your account",
    description:
      "Configure your profile, connect your email, and set your notification preferences.",
    details: [
      "Add your display name and avatar",
      "Verify your email address",
      "Choose notification channels (email, Telegram)",
    ],
    action: { label: "Go to settings", href: "/settings" },
  },
  {
    id: 2,
    title: "Connect integrations",
    description:
      "Link external services so Prometheus can act on your behalf across platforms.",
    details: [
      "Connect your Telegram account for real-time alerts",
      "Authorize browser access for web automation",
      "Add API keys for third-party services",
    ],
    action: { label: "View integrations", href: "/settings" },
  },
  {
    id: 3,
    title: "Run your first task",
    description:
      "Try an interactive session: give Prometheus a task and watch it execute in real time.",
    details: [
      "Open the chat interface",
      "Describe a task in plain language",
      "Review results and tool calls in the activity log",
    ],
    action: { label: "Open chat", href: "/dashboard" },
  },
  {
    id: 4,
    title: "Set up scheduling",
    description:
      "Create recurring jobs so Prometheus can run tasks automatically on a schedule.",
    details: [
      "Define a cron expression or pick a preset interval",
      "Write the task prompt that runs each cycle",
      "Monitor job history and results from the dashboard",
    ],
    action: { label: "Create schedule", href: "/dashboard" },
  },
];

function StepIcon({ step, completed }: { step: number; completed: boolean }) {
  if (completed) {
    return (
      <div className="w-8 h-8 rounded-full bg-ember flex items-center justify-center shrink-0">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-full border-2 border-border bg-charcoal flex items-center justify-center shrink-0">
      <span className="text-sm font-semibold text-muted">{step}</span>
    </div>
  );
}

export default function GetStartedPage() {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  function toggleStep(id: number) {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const completedCount = completedSteps.size;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
        <h1 className="text-2xl font-bold text-foreground">Get started</h1>
        <p className="text-muted mt-1">
          Follow these steps to set up your Prometheus workspace.
        </p>
      </motion.div>

      {/* Progress bar */}
      <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp}>
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-foreground">
              Setup progress
            </p>
            <span className="text-sm text-muted">
              {completedCount} of {steps.length} complete
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-ember"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </Card>
      </motion.div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, i) => {
          const completed = completedSteps.has(step.id);

          return (
            <motion.div
              key={step.id}
              initial="hidden"
              animate="visible"
              custom={i + 2}
              variants={fadeUp}
            >
              <Card className={completed ? "border-ember/20 bg-ember/[0.02]" : ""}>
                <div className="flex gap-4">
                  {/* Step indicator + connector */}
                  <div className="flex flex-col items-center">
                    <StepIcon step={step.id} completed={completed} />
                    {step.id < steps.length && (
                      <div className="w-px flex-1 bg-border mt-2" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-base font-semibold text-foreground">
                        {step.title}
                      </h3>
                      {completed && <Badge variant="green">Done</Badge>}
                    </div>
                    <p className="text-sm text-muted">{step.description}</p>

                    <ul className="mt-3 space-y-1.5">
                      {step.details.map((detail) => (
                        <li
                          key={detail}
                          className="flex items-start gap-2 text-sm text-muted"
                        >
                          <span
                            className="mt-1.5 w-1 h-1 rounded-full bg-muted/50 shrink-0"
                            aria-hidden="true"
                          />
                          {detail}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-4 flex items-center gap-3">
                      <Button
                        variant={completed ? "ghost" : "secondary"}
                        size="sm"
                        href={step.action.href}
                      >
                        {step.action.label}
                      </Button>
                      <button
                        onClick={() => toggleStep(step.id)}
                        className="text-xs text-muted hover:text-foreground transition-colors"
                        aria-label={
                          completed
                            ? `Mark "${step.title}" as incomplete`
                            : `Mark "${step.title}" as complete`
                        }
                      >
                        {completed
                          ? "Mark as incomplete"
                          : "Mark as complete"}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Completion message */}
      {completedCount === steps.length && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-ember/30 text-center">
            <div className="py-4">
              <p className="text-lg font-semibold text-foreground mb-1">
                All set!
              </p>
              <p className="text-sm text-muted mb-4">
                Your workspace is fully configured. Start using Prometheus to
                automate your workflow.
              </p>
              <Button variant="primary" size="md" href="/dashboard">
                Go to dashboard
              </Button>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
