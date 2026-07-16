"use client";
import useSWR from "swr";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { CitizenReport, CreateReportPayload } from "@/lib/types";

// Citizen identity: stored in localStorage (Q2 open)
const WARD_KEY = "aq_citizen_ward";

export function useCitizenWard() {
  const [wardId, setWardIdState] = useState<string | null>(null);

  useEffect(() => {
    setWardIdState(localStorage.getItem(WARD_KEY));
  }, []);

  const setWardId = (id: string) => {
    localStorage.setItem(WARD_KEY, id);
    setWardIdState(id);
  };

  const clearWard = () => {
    localStorage.removeItem(WARD_KEY);
    setWardIdState(null);
  };

  return { wardId, setWardId, clearWard };
}

export function useReports() {
  const { data, error, isLoading, mutate } = useSWR<CitizenReport[]>(
    "reports",
    () => api.getReports(),
    { revalidateOnFocus: false }
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitReport = async (payload: CreateReportPayload): Promise<CitizenReport | null> => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const report = await api.submitReport(payload);
      // Optimistic update
      mutate((prev) => (prev ? [report, ...prev] : [report]), false);
      await mutate();
      return report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setSubmitError(msg);
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    reports: data ?? [],
    error,
    isLoading,
    submitting,
    submitError,
    submitReport,
    refresh: mutate,
  };
}
