import { useContext, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import type { OrganizationBannerConfig } from "@ccr/core/contracts/app";
import { MdButton } from "@/components/md3";
import { cn } from "@/lib/utils";
import { AppI18nContext } from "@/pages/home/shared/i18n";

/*
 * Presentational organization banner: an M3-styled announcement strip shown at
 * the top of the home header. Renders nothing when no config has arrived yet,
 * when the banner is disabled, or when it has neither text nor a usable image.
 */

export function isRenderableOrganizationBannerImage(value: string | undefined): value is string {
  if (!value || !/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function HomeBanner({
  banner,
  className
}: {
  banner?: OrganizationBannerConfig | null;
  className?: string;
}) {
  const copy = useContext(AppI18nContext);
  const shouldReduceMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  // A re-enabled or edited banner is worth showing again after a dismissal.
  useEffect(() => {
    setDismissed(false);
    setImageFailed(false);
  }, [banner?.enabled, banner?.imageUrl, banner?.text]);

  if (!banner?.enabled || dismissed) {
    return null;
  }

  const text = typeof banner.text === "string" ? banner.text.trim() : "";
  const showImage = !imageFailed && isRenderableOrganizationBannerImage(banner.imageUrl);
  if (!text && !showImage) {
    return null;
  }

  return (
    <motion.section
      animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
      aria-label={copy.settings.organizationBanner}
      className={cn(
        "app-no-drag mx-5 mt-2 flex min-h-[48px] shrink-0 flex-wrap items-center gap-3 rounded-[var(--md-sys-shape-corner-medium)] px-4 py-2",
        "max-[720px]:mx-3",
        className
      )}
      initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
      style={{
        background: "var(--md-sys-color-secondary-container)",
        color: "var(--md-sys-color-on-secondary-container)"
      }}
      transition={shouldReduceMotion ? undefined : { duration: 0.2, ease: "easeOut" }}
    >
      {showImage ? (
        <img
          alt={text || copy.settings.organizationBanner}
          className="h-10 w-10 shrink-0 rounded-[var(--md-sys-shape-corner-small)] object-cover"
          decoding="async"
          onError={() => setImageFailed(true)}
          src={banner.imageUrl}
        />
      ) : null}
      {text ? (
        <p
          className="min-w-0 flex-1 whitespace-pre-wrap break-words"
          style={{
            fontSize: "var(--md-sys-typescale-body-medium-font-size)",
            fontWeight: "var(--md-sys-typescale-body-medium-font-weight)",
            lineHeight: "var(--md-sys-typescale-body-medium-line-height)"
          }}
        >
          {text}
        </p>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      <MdButton
        aria-label={copy.settings.organizationBannerDismiss}
        className="shrink-0"
        onClick={() => setDismissed(true)}
        size="sm"
        title={copy.settings.organizationBannerDismiss}
        variant="text"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </MdButton>
    </motion.section>
  );
}
