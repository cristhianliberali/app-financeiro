import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAuthConfig,
  getCurrentUser,
  signIn as signInFn,
  signOut as signOutFn,
  signUp as signUpFn,
  type AuthedUser,
} from "@/lib/auth.functions";

export type { AuthedUser };

export const AUTH_QUERY_KEY = ["auth", "user"] as const;
const AUTH_CONFIG_KEY = ["auth", "config"] as const;

/**
 * Sessão do usuário logado.
 *
 * A sessão vive num cookie httpOnly, então o cliente não consegue lê-la
 * direto: quem responde quem está logado é o servidor, e o React Query guarda
 * essa resposta em cache para as telas.
 */
export function useAuth() {
  const qc = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => getCurrentUser(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const user = data ?? null;

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await signInFn({ data: { email, password } });
      qc.setQueryData(AUTH_QUERY_KEY, next);
      await qc.invalidateQueries();
      return next;
    },
    [qc],
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: string) => {
      const next = await signUpFn({ data: { email, password, ...(name ? { name } : {}) } });
      qc.setQueryData(AUTH_QUERY_KEY, next);
      await qc.invalidateQueries();
      return next;
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    await signOutFn();
    qc.setQueryData(AUTH_QUERY_KEY, null);
    qc.clear();
  }, [qc]);

  return { user, loading: isPending, signIn, signUp, signOut };
}

/** Configuração pública da tela de entrada (cadastro aberto ou fechado). */
export function useAuthConfig() {
  return useQuery({
    queryKey: AUTH_CONFIG_KEY,
    queryFn: () => getAuthConfig(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
