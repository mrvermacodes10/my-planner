"use client";

import { createContext, useContext } from "react";

/** Which date the Daily Planner is showing — shared so the AI knows what you are looking at. */
export const ViewContext = createContext<{ plannerDate: string; setPlannerDate: (d: string) => void }>({
  plannerDate: "",
  setPlannerDate: () => {},
});

export const useView = () => useContext(ViewContext);
