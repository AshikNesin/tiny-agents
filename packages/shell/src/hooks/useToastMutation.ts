import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { describeError, toastSuccess } from "@groot/shell/lib/feedback";

type ToastContent = string | { title: string; description?: string };

interface ToastMutationConfig<TData, TVars> {
  success?: ToastContent | ((data: TData, vars: TVars) => ToastContent);
  error?: ToastContent;
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
}

/**
 * @deprecated Use `useAction` from `@groot/shell/lib/feedback`, which also owns confirmation,
 * double-submit and invalidation. Kept for existing callers.
 */
export function useToastMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  config: ToastMutationConfig<TData, TVars> = {},
) {
  return useMutation<TData, Error, TVars>({
    mutationFn,
    onSuccess: async (data, vars) => {
      if (config.success) {
        const content =
          typeof config.success === "function" ? config.success(data, vars) : config.success;
        toastSuccess(content);
      }
      await config.onSuccess?.(data, vars);
    },
    onError: (error) => {
      console.error(error);
      const content = config.error;
      if (typeof content === "string") toast.error(describeError(error, content));
      else if (content) {
        toast.error(content.title, {
          description: describeError(error, content.description ?? "") || undefined,
        });
      }
    },
  });
}
