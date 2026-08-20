import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toISODate } from "./format";

export type DateBasis = "transaction_date" | "due_date";

type Ctx = {
  profileId: string | null;
  setProfileId: (id: string) => void;
  dateBasis: DateBasis;
  setDateBasis: (b: DateBasis) => void;
  from: string;
  to: string;
  setRange: (from: string, to: string) => void;
};

const AppStateContext = createContext<Ctx | null>(null);

const startOfMonth = () => {
  const d = new Date();
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
};
const endOfMonth = () => {
  const d = new Date();
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profileId, setProfileIdState] = useState<string | null>(null);
  const [dateBasis, setDateBasisState] = useState<DateBasis>("transaction_date");
  const [from, setFrom] = useState(startOfMonth);
  const [to, setTo] = useState(endOfMonth);

  useEffect(() => {
    const saved = localStorage.getItem("aura.profileId");
    if (saved) setProfileIdState(saved);
    const basis = localStorage.getItem("aura.dateBasis") as DateBasis | null;
    if (basis) setDateBasisState(basis);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      profileId,
      setProfileId: (id) => {
        localStorage.setItem("aura.profileId", id);
        setProfileIdState(id);
      },
      dateBasis,
      setDateBasis: (b) => {
        localStorage.setItem("aura.dateBasis", b);
        setDateBasisState(b);
      },
      from,
      to,
      setRange: (f, t) => {
        setFrom(f);
        setTo(t);
      },
    }),
    [profileId, dateBasis, from, to],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de AppStateProvider");
  return ctx;
}
