import {
  AddProfileDraft, AddProviderDraft, AppConfig, Button, Check, ChevronLeft,
  ChevronRight, cn, findProviderPreset, GatewayProviderProbeResult, GatewayStatus, Gauge, getNextOnboardingStep,
  isOnboardingProfileReady, isOnboardingProviderReady, Layers3, LucideIcon, mergeProviderModelLists, motion, motionEase,
  LoaderCircle, onboardingMascotSpriteUrl, OnboardingReadinessOptions, OnboardingStepId, onboardingStepOrder, type ProfileAgentOption, providerDraftHasReadyCredentialPool, ProviderConnectivityCheckReport, reducedMotionTransition, splitLines, useAppText, useEffect, useReducedMotion,
  useState,
  UserRound, X
} from "../shared/index";
import { MdButton } from "@/components/md3";
import { AddProviderForm, ProviderConnectivityCheckDialog, providerSetupStepIds, type ProviderSetupStepId } from "./providers";
import { AddProfileForm } from "./profiles";

type OnboardingMascotTone = "cyan" | "orange" | "violet";

const onboardingStepDetails: Record<OnboardingStepId, {
  description: string;
  icon: LucideIcon;
  title: string;
  tone: OnboardingMascotTone;
}> = {
  provider: {
    description: "Add or verify a model provider.",
    icon: Layers3,
    title: "Configure provider",
    tone: "violet"
  },
  profile: {
    description: "Create a profile for your agent.",
    icon: UserRound,
    title: "Connect agent",
    tone: "orange"
  },
  enter: {
    description: "Start using CCR.",
    icon: Gauge,
    title: "Let's start",
    tone: "cyan"
  }
};

export function OnboardingView({
  activeStep,
  agentOptions,
  canSubmitProfile,
  canSubmitProvider,
  config,
  endpoint,
  gatewayStatus,
  onCheckProvider,
  onChangeProfile,
  onChangeProvider,
  onComplete,
  onSelectStep,
  onSubmitProfile,
  onSubmitProvider,
  profileDraft,
  profileError,
  providerDraft,
  providerError,
  providerConnectivityLoading,
  providerConnectivityProbe,
  providerProbe,
  providerProbeLoading,
  readiness
}: {
  activeStep: OnboardingStepId;
  agentOptions: ProfileAgentOption[];
  canSubmitProfile: boolean;
  canSubmitProvider: boolean;
  config: AppConfig;
  endpoint: string;
  gatewayStatus: GatewayStatus;
  onCheckProvider: (models?: string[]) => Promise<ProviderConnectivityCheckReport>;
  onChangeProfile: (patch: Partial<AddProfileDraft>) => void;
  onChangeProvider: (patch: Partial<AddProviderDraft>, resetProbe?: boolean) => void;
  onComplete: () => void | Promise<void>;
  onSelectStep: (step: OnboardingStepId) => void;
  onSubmitProfile: () => Promise<boolean>;
  onSubmitProvider: () => Promise<boolean>;
  profileDraft: AddProfileDraft;
  profileError: string;
  providerDraft: AddProviderDraft;
  providerError: string;
  providerConnectivityLoading: boolean;
  providerConnectivityProbe?: GatewayProviderProbeResult;
  providerProbe?: GatewayProviderProbeResult;
  providerProbeLoading: boolean;
  readiness?: OnboardingReadinessOptions;
}) {
  const t = useAppText();
  const shouldReduceMotion = useReducedMotion();
  const [providerCheckOpen, setProviderCheckOpen] = useState(false);
  const [providerIconDetecting, setProviderIconDetecting] = useState(false);
  const [providerSetupStep, setProviderSetupStep] = useState<ProviderSetupStepId>("provider");
  const providerReady = isOnboardingProviderReady(config);
  const profileReady = isOnboardingProfileReady(config, readiness);
  const serviceReady = gatewayStatus.state === "running";
  const routeReady = providerReady && profileReady;
  const activeIndex = Math.max(0, onboardingStepOrder.indexOf(activeStep));
  const activeDetails = onboardingStepDetails[activeStep];
  const previousStep = onboardingStepOrder[activeIndex - 1];
  const nextStep = getNextOnboardingStep(activeStep, config, readiness);
  const localAgentProviderImport = providerDraft.providerPlugins.length > 0;
  const providerIdentityReady = Boolean(findProviderPreset(providerDraft.presetId) || providerDraft.baseUrl.trim());
  const providerCredentialReady = localAgentProviderImport || Boolean(
    providerDraft.credentialMode === "pool"
      ? providerDraftHasReadyCredentialPool(providerDraft)
      : providerDraft.apiKey.trim()
  );
  const providerCheckModels = mergeProviderModelLists(providerDraft.selectedModels, splitLines(providerDraft.modelsText));
  const providerModelsReady = providerCheckModels.length > 0;
  const providerSetupIndex = Math.max(0, providerSetupStepIds.indexOf(providerSetupStep));
  const previousProviderSetupStep = activeStep === "provider" ? providerSetupStepIds[providerSetupIndex - 1] : undefined;
  const nextProviderSetupStep = activeStep === "provider" ? providerSetupStepIds[providerSetupIndex + 1] : undefined;
  const providerSubmitLoading = activeStep === "provider" && (providerProbeLoading || providerConnectivityLoading || providerIconDetecting);
  const nextDisabled = activeStep === "provider"
    ? providerSubmitLoading || (nextProviderSetupStep
      ? !isProviderSetupStepReady(providerSetupStep)
      : !(providerReady || canSubmitProvider))
    : activeStep === "profile"
      ? !(profileReady || (providerReady && canSubmitProfile))
      : !routeReady;

  useEffect(() => {
    if (activeStep !== "provider" || isProviderSetupStepUnlocked(providerSetupStep)) {
      return;
    }
    setProviderSetupStep(getLatestUnlockedProviderSetupStep());
  }, [activeStep, providerCredentialReady, providerIdentityReady, providerModelsReady, providerSetupStep]);

  function isProviderSetupStepReady(step: ProviderSetupStepId): boolean {
    switch (step) {
      case "provider":
        return providerIdentityReady;
      case "credentials":
        return providerCredentialReady;
      case "models":
        return providerModelsReady;
      case "verify":
        return true;
    }
  }

  function isProviderSetupStepUnlocked(step: ProviderSetupStepId): boolean {
    switch (step) {
      case "provider":
        return true;
      case "credentials":
        return providerIdentityReady;
      case "models":
        return providerIdentityReady && providerCredentialReady;
      case "verify":
        return providerIdentityReady && providerCredentialReady && providerModelsReady;
    }
  }

  function getLatestUnlockedProviderSetupStep(): ProviderSetupStepId {
    return [...providerSetupStepIds].reverse().find(isProviderSetupStepUnlocked) ?? "provider";
  }

  function goToPreviousStep() {
    if (activeStep === "provider" && previousProviderSetupStep) {
      setProviderSetupStep(previousProviderSetupStep);
      return;
    }
    if (previousStep) {
      if (previousStep === "provider") {
        setProviderSetupStep(getLatestUnlockedProviderSetupStep());
      }
      onSelectStep(previousStep);
    }
  }

  async function goToNextStep() {
    if (activeStep === "enter") {
      if (routeReady) {
        await onComplete();
      }
      return;
    }

    if (activeStep === "provider") {
      if (providerSubmitLoading) {
        return;
      }
      if (nextProviderSetupStep) {
        if (isProviderSetupStepReady(providerSetupStep)) {
          setProviderSetupStep(nextProviderSetupStep);
        }
        return;
      }
      if (canSubmitProvider) {
        const saved = await onSubmitProvider();
        if (saved) {
          return;
        }
      }
      if (providerReady && nextStep) {
        onSelectStep(nextStep);
      }
      return;
    }

    if (activeStep === "profile" && !profileReady) {
      await onSubmitProfile();
      return;
    }

    if (nextStep) {
      onSelectStep(nextStep);
    }
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex h-full min-h-0 w-full flex-col"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-card">
          <motion.div
            className="relative z-10 flex h-full min-h-0 flex-1 flex-col overflow-hidden"
            layout
            style={{ transformPerspective: 900 }}
            transition={shouldReduceMotion ? reducedMotionTransition : { duration: 0.28, ease: motionEase }}
          >
            <OnboardingProgress activeStep={activeStep} providerSetupStep={providerSetupStep} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-5">
              <div className="flex h-8 shrink-0 items-center">
                {previousStep || previousProviderSetupStep ? (
                  <Button
                    className="md-type-label-large inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[var(--md-sys-color-on-surface-variant)] outline-none transition-colors duration-[var(--md-sys-motion-duration-short3)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,transparent)] hover:text-[var(--md-sys-color-on-surface)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--md-sys-color-primary)]"
                    onClick={goToPreviousStep}
                    type="button"
                    unstyled
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("Back")}
                  </Button>
                ) : null}
              </div>

              <div className="flex min-w-0 shrink-0 flex-col items-center gap-2 text-center">
                <OnboardingMascotSprite activeStep={activeStep} />
                <div className="min-w-0">
                  <h2 className="md-type-headline-small">{t(activeDetails.title)}</h2>
                  <p className="md-type-body-medium mt-1 text-[var(--md-sys-color-on-surface-variant)]">{t(activeDetails.description)}</p>
                </div>
              </div>

              <div className="onboarding-step-panels mt-5 min-h-0 flex-1 overflow-hidden">
                <div
                  aria-hidden={activeStep !== "provider"}
                  className={cn("onboarding-step-panel flex min-w-0 flex-1 flex-col gap-3", activeStep === "provider" && "onboarding-step-panel-active")}
                >
                  <div className="mx-auto w-full max-w-[780px]">
                    <AddProviderForm
                      connectivityLoading={providerConnectivityLoading}
                      connectivityProbe={providerConnectivityProbe}
                      draft={providerDraft}
                      error={providerError}
                      activeStep={providerSetupStep}
                      mode={providerReady ? "edit" : "add"}
                      onCheck={async () => setProviderCheckOpen(true)}
                      onChange={onChangeProvider}
                      onIconDetectingChange={setProviderIconDetecting}
                      onSelectStep={(step) => {
                        if (isProviderSetupStepUnlocked(step)) {
                          setProviderSetupStep(step);
                        }
                      }}
                      probe={providerProbe}
                      probeLoading={providerProbeLoading}
                      providerPlugins={config.providerPlugins ?? []}
                      providers={config.Providers}
                    />
                  </div>
                </div>

                <div
                  aria-hidden={activeStep !== "profile"}
                  className={cn("onboarding-step-panel flex min-w-0 flex-1 flex-col gap-3", activeStep === "profile" && "onboarding-step-panel-active")}
                >
                  <div className="mx-auto w-full max-w-[720px]">
                    <AddProfileForm
                      agentOptions={agentOptions}
                      botConfigs={[]}
                      draft={profileDraft}
                      error={profileError}
                      onChange={onChangeProfile}
                      onCreateBot={() => undefined}
                      providers={config.Providers}
                      virtualModelProfiles={config.virtualModelProfiles ?? []}
                    />
                  </div>
                </div>

                <div
                  aria-hidden={activeStep !== "enter"}
                  className={cn("onboarding-step-panel flex min-w-0 flex-1 flex-col gap-3", activeStep === "enter" && "onboarding-step-panel-active")}
                >
                  <div className="mx-auto flex w-full max-w-[520px] flex-col overflow-hidden rounded-[var(--md-sys-shape-corner-large)] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] shadow-[var(--md-elevation-level1)]">
                    <OnboardingStatusRow label={t("Provider")} ready={providerReady} />
                    <OnboardingStatusRow label={t("Profile")} ready={profileReady} />
                    <OnboardingStatusRow label={t("Service")} ready={serviceReady} />
                    <OnboardingDetailRow label={t("Endpoint")} value={endpoint} />
                  </div>
                  <div className="mt-auto flex flex-wrap items-center justify-center gap-2">
                    {!providerReady ? (
                      <MdButton onClick={() => onSelectStep("provider")} size="sm" type="button" variant="outlined">
                        {t("Configure provider")}
                      </MdButton>
                    ) : null}
                    {providerReady && !profileReady ? (
                      <MdButton onClick={() => onSelectStep("profile")} size="sm" type="button" variant="outlined">
                        {t("Connect agent")}
                      </MdButton>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex shrink-0 items-center justify-end gap-3 border-t border-border/60 pt-4 max-[640px]:items-stretch">
                <MdButton disabled={nextDisabled} onClick={() => void goToNextStep()} size="sm" type="button">
                  {providerSubmitLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : activeStep === "enter" ? <Check className="h-4 w-4" /> : null}
                  {providerSubmitLoading ? t("Loading") : activeStep === "enter" ? t("Let's start") : t("Next step")}
                  {!providerSubmitLoading && activeStep !== "enter" ? <ChevronRight className="h-4 w-4" /> : null}
                </MdButton>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {providerCheckOpen ? (
        <ProviderConnectivityCheckDialog
          connectivityLoading={providerConnectivityLoading}
          models={providerCheckModels}
          onCheck={onCheckProvider}
          onClose={() => setProviderCheckOpen(false)}
        />
      ) : null}
    </motion.div>
  );
}

const onboardingProgressItems: Array<{ key: ProviderSetupStepId | "profile" | "enter"; label: string }> = [
  { key: "provider", label: "Choose provider" },
  { key: "credentials", label: "Add credentials" },
  { key: "models", label: "Pick models" },
  { key: "verify", label: "Verify connection" },
  { key: "profile", label: "Connect agent" },
  { key: "enter", label: "Let's start" }
];

function OnboardingProgress({
  activeStep,
  providerSetupStep
}: {
  activeStep: OnboardingStepId;
  providerSetupStep: ProviderSetupStepId;
}) {
  const t = useAppText();
  const activeKey = activeStep === "provider" ? providerSetupStep : activeStep;
  const activeIndex = Math.max(0, onboardingProgressItems.findIndex((item) => item.key === activeKey));
  const stepCount = onboardingProgressItems.length;
  const progressWidth = `${((activeIndex + 1) / stepCount) * 100}%`;

  return (
    <div className="relative shrink-0 border-b border-border/60 bg-card/95" aria-label={`${t("Step")} ${activeIndex + 1} / ${stepCount}`}>
      <div className="md-type-label-medium mx-auto flex h-11 max-w-[920px] items-center justify-start overflow-x-auto px-3 sm:justify-center">
        {onboardingProgressItems.map((item, index) => (
          <div className="flex shrink-0 items-center" key={item.key}>
            <span
              className={cn(
                "max-w-[128px] truncate max-[560px]:max-w-[96px]",
                index === activeIndex ? "text-[var(--md-sys-color-primary)]" : "text-[var(--md-sys-color-on-surface-variant)]"
              )}
            >
              {t(item.label)}
            </span>
            {index < stepCount - 1 ? <ChevronRight className="mx-2.5 h-4 w-4 shrink-0 text-[var(--md-sys-color-outline)] max-[560px]:mx-1.5" /> : null}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--md-sys-color-surface-container-highest)]" role="progressbar" aria-valuemin={1} aria-valuemax={stepCount} aria-valuenow={activeIndex + 1}>
        <div className="h-full bg-[var(--md-sys-color-primary)] transition-[width] duration-[var(--md-sys-motion-duration-short4)] ease-[var(--md-sys-motion-easing-standard)]" style={{ width: progressWidth }} />
      </div>
    </div>
  );
}

function OnboardingStatusRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
      <span className="md-type-body-medium min-w-0 truncate font-medium text-[var(--md-sys-color-on-surface)]">{label}</span>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          ready ? "bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]" : "bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]"
        )}
      >
        {ready ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
      </span>
    </div>
  );
}

function OnboardingDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
      <span className="md-type-body-medium min-w-0 truncate font-medium text-[var(--md-sys-color-on-surface)]">{label}</span>
      <span className="md-type-body-medium min-w-0 max-w-[68%] truncate text-right font-mono text-[var(--md-sys-color-on-surface-variant)]" title={value}>{value}</span>
    </div>
  );
}

function OnboardingMascotSprite({ activeStep }: { activeStep: OnboardingStepId }) {
  return (
    <div
      aria-hidden
      className={cn("onboarding-mascot-sprite", `onboarding-mascot-sprite-${activeStep}`)}
      style={{
        backgroundImage: `url(${onboardingMascotSpriteUrl})`
      }}
    />
  );
}
