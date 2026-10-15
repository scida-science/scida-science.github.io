import type { Discovery } from "../../src/types";

// Test-only records: never import this module into application runtime code.
// All records below are fictional examples. Stage labels demonstrate the workflow;
// they do not report real validation, publication, or scientific discoveries.
export const discoveries: Discovery[] = [
  {
    illustrative: true,
    id: "AI-001",
    title: "Adaptive exploration under delayed feedback",
    field: "Artificial Intelligence",
    topic: "bandit-theory",
    status: "Awaiting Validation",
    summary:
      "An illustrative bandit policy that adjusts exploration to outstanding feedback, with an open question about delay-dependent regret.",
    updatedAt: "2026-10-14T08:30:00Z",
    version: "v0.2",
    reviewNote:
      "Review focus: does Assumption A1 suffice for the proposed confidence bound under adaptive sampling?",
    sections: [
      {
        id: "problem",
        title: "Short problem formulation and assumptions",
        body: "Illustrative example. A learner selects one of K arms and observes its reward after a delay. Assumption A1 specifies independent, bounded rewards and delays independent of the reward conditional on the selected arm. The horizon and delay distribution are unknown. This is a proposed setting for expert discussion, not a reported result.",
        equation: "R_T = \\sum_{t=1}^{T}(\\mu^* - \\mu_{A_t})",
      },
      {
        id: "proposal",
        title: "What we propose",
        body: "Use an upper-confidence index based on observed rewards, alongside a cap on the number of unresolved pulls of each arm. The cap increases with the number of completed observations. An explicit fallback action is needed when every arm reaches its cap.",
      },
      {
        id: "rationale",
        title: "Why this approach",
        body: "A confidence index alone can repeatedly select an arm while its feedback remains outstanding. Tracking unresolved pulls may reduce this behavior, but the cap can also postpone useful exploration. Both effects must appear in the analysis.",
      },
      {
        id: "claim",
        title: "Main claimed result",
        body: "The example conjectures that, under additional conditions on delay tails, regret can be separated into a standard exploration term and a term controlling unresolved feedback. No theorem is established here, and no quantitative improvement is claimed.",
      },
      {
        id: "evidence",
        title: "Short proof idea or experimental evidence",
        body: "A possible proof would first obtain a simultaneous confidence event for completed observations, then charge suboptimal selections either to uncertainty or to the delay cap. The fallback rule needs a separate argument. No experiments or proof files have been uploaded.",
      },
      {
        id: "limitations",
        title: "Limitations and questions requiring expert review",
        body: "Check whether reward-independent delays are sufficient for the concentration step, whether the fallback can dominate regret, and what happens with heavy-tailed or adversarial delays. Any comparison should report the same delay model and feedback budget.",
      },
    ],
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  },
  {
    illustrative: true,
    id: "AST-001",
    title: "Separating transient signals from survey cadence",
    field: "Astronomy",
    topic: "time-domain-astronomy",
    status: "Awaiting Validation",
    summary:
      "An illustrative test of whether a short-timescale brightness feature survives changes in sampling and background estimation.",
    updatedAt: "2026-10-13T11:00:00Z",
    version: "v0.1",
    reviewNote:
      "Review focus: distinguish an intrinsic transient from window-function and background-subtraction effects.",
    sections: [
      {
        id: "question",
        title: "Scientific question",
        body: "Illustrative example. Could a short brightening in an irregularly sampled light curve represent intrinsic variability rather than a feature introduced by the observing schedule? No real astronomical source or observed event is identified in this brief.",
      },
      {
        id: "observations",
        title: "Observations and datasets",
        body: "The proposed exercise uses synthetic light curves with known injected events, observation timestamps, measurement uncertainties, and a background estimate. No survey data have been downloaded, and no dataset is available in this prototype.",
      },
      {
        id: "method",
        title: "Analysis method",
        body: "Fit a baseline variability model and an event model using the same observation times. Repeat the comparison under alternative background estimates and missing-data patterns. Calibrate the detection statistic with simulations that reproduce the cadence and noise.",
      },
      {
        id: "finding",
        title: "Proposed finding or interpretation",
        body: "The illustrative interpretation is that a candidate would deserve follow-up only if its significance remains stable across the predefined analysis checks. The prototype does not claim that any transient has been detected.",
      },
      {
        id: "evidence",
        title: "Supporting evidence and uncertainty",
        body: "A future validation record should report recovery efficiency, false-positive frequency, and uncertainty in the inferred event duration. It should also show the sampling window beside the light curve. All supporting materials remain unuploaded.",
      },
      {
        id: "alternatives",
        title: "Alternative explanations and outstanding checks",
        body: "Examine detector artifacts, correlated background noise, nearby variable sources, and selection after inspecting the data. A second observing band or independent instrument would help test an intrinsic interpretation.",
      },
    ],
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  },
  {
    illustrative: true,
    id: "AI-002",
    title: "Calibrating uncertainty when observations are sparse",
    field: "Artificial Intelligence",
    topic: "machine-learning",
    status: "Validated",
    summary:
      "An illustrative evaluation of split-conformal prediction intervals across predefined groups with different observation density.",
    updatedAt: "2026-10-11T09:15:00Z",
    version: "v1.0",
    reviewNote:
      "Illustrative validation record: a demo methods review is marked complete; no real evaluation or validation has occurred.",
    sections: [
      {
        id: "problem",
        title: "Short problem formulation and assumptions",
        body: "Illustrative example. A regression model predicts a continuous outcome from partially observed features. Training, calibration, and test examples are assumed exchangeable after a fixed preprocessing rule. Observation-density groups are defined before examining calibration outcomes.",
      },
      {
        id: "proposal",
        title: "What we propose",
        body: "Evaluate a standard split-conformal interval and a version calibrated separately within the predefined groups. Compare coverage and interval width at a common target level, while reporting the number of calibration examples in each group.",
        equation:
          "\\widehat C(x) = [\\widehat f(x)-q_{1-\\alpha},\\;\\widehat f(x)+q_{1-\\alpha}]",
      },
      {
        id: "rationale",
        title: "Why this approach",
        body: "Aggregate coverage can obscure differences associated with missing observations. Groupwise evaluation makes these differences visible, while separate calibration may produce wider or unstable intervals when a group is small.",
      },
      {
        id: "claim",
        title: "Main claimed result",
        body: "The example proposes assessing whether groupwise calibration improves coverage balance at an acceptable interval width. It reports no numerical result. The Validated badge demonstrates a workflow stage and does not certify this hypothesis.",
      },
      {
        id: "evidence",
        title: "Short proof idea or experimental evidence",
        body: "The planned experiment fixes preprocessing and groups before splitting the data, repeats the evaluation across random splits, and reports uncertainty for empirical coverage. A formal guarantee would require the appropriate finite-sample quantile and exchangeability within each calibration group.",
      },
      {
        id: "limitations",
        title: "Limitations and questions requiring expert review",
        body: "Review the consequences of small groups, distribution shift, data-dependent grouping, and informative missingness. Marginal or groupwise coverage should not be described as coverage conditional on every individual feature vector.",
      },
    ],
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  },
  {
    illustrative: true,
    id: "AST-002",
    title: "Testing the stability of transit-timing residuals",
    field: "Astronomy",
    topic: "exoplanets",
    status: "Validated",
    summary:
      "An illustrative sensitivity analysis of transit times under alternative detrending choices and correlated-noise models.",
    updatedAt: "2026-10-09T13:20:00Z",
    version: "v1.1",
    reviewNote:
      "Illustrative validation record: the demo robustness checklist is complete; no actual transit measurements were validated.",
    sections: [
      {
        id: "question",
        title: "Scientific question",
        body: "Illustrative example. Would an apparent deviation from a linear transit ephemeris remain after accounting for reasonable choices of baseline and noise model? The brief concerns a synthetic planetary system, not a known exoplanet.",
      },
      {
        id: "observations",
        title: "Observations and datasets",
        body: "A proposed synthetic dataset contains transit light curves, exposure times, uncertainty estimates, and injected stellar variability. Its purpose is to test measurement sensitivity with known ground truth. No light curves or instrument data are supplied.",
      },
      {
        id: "method",
        title: "Analysis method",
        body: "Fit each transit jointly with its local baseline, then compare timing residuals against a shared linear ephemeris. Repeat the analysis with several predefined detrending families and a correlated-noise model, keeping the timing convention consistent.",
      },
      {
        id: "finding",
        title: "Proposed finding or interpretation",
        body: "A persistent residual pattern would motivate a dynamical interpretation only after instrumental and stellar effects are checked. This example makes no claim of a planetary companion or detected transit-timing variation. Its status is solely a demonstration.",
      },
      {
        id: "evidence",
        title: "Supporting evidence and uncertainty",
        body: "The intended evidence includes timing posteriors, injection-recovery tests, residual correlations, and sensitivity to individual transits. Uncertainty in the reference ephemeris should propagate into the residual analysis. No completed analysis is available.",
      },
      {
        id: "alternatives",
        title: "Alternative explanations and outstanding checks",
        body: "Check starspot crossings, finite exposure integration, timestamp conversion, baseline flexibility, and outlier treatment. A periodic pattern alone would not establish the presence or properties of another planet.",
      },
    ],
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  },
  {
    illustrative: true,
    id: "AI-003",
    title: "Tracing scientific claims to executable evidence",
    field: "Artificial Intelligence",
    topic: "scientific-ai",
    status: "Published",
    summary:
      "An illustrative protocol for connecting claims generated by a research agent to versioned experiments and independently inspectable outputs.",
    updatedAt: "2026-10-06T10:45:00Z",
    version: "v1.0",
    reviewNote:
      "Illustrative publication record: this badge represents a demo stage; there is no publication, DOI, or uploaded manuscript.",
    sections: [
      {
        id: "problem",
        title: "Short problem formulation and assumptions",
        body: "Illustrative example. A scientific agent proposes claims and runs computational experiments. The evaluation assumes a fixed benchmark, recorded software dependencies, and access to the inputs required to reproduce each experiment. Fluent explanations alone are not treated as evidence.",
      },
      {
        id: "proposal",
        title: "What we propose",
        body: "Represent each claim with its assumptions, a versioned experiment specification, an output artifact, and an explicit verification criterion. Record which claims depend on other claims so a changed experiment can trigger targeted re-evaluation.",
      },
      {
        id: "rationale",
        title: "Why this approach",
        body: "A structured evidence record can make omissions easier to identify and reduce the effort needed to inspect a result. Its usefulness depends on the quality of the verification criteria and the independence of the reviewer.",
      },
      {
        id: "claim",
        title: "Main claimed result",
        body: "The illustrative hypothesis is that explicit claim-to-evidence records improve reviewers’ ability to identify unsupported conclusions. No user study, performance improvement, or publication is claimed. The Published stage is a placeholder for the eventual workflow.",
      },
      {
        id: "evidence",
        title: "Short proof idea or experimental evidence",
        body: "A prospective evaluation would compare review accuracy and time with and without the records, using the same underlying scientific tasks and predefined error categories. Task assignment and scoring should be blinded where possible. No study results are supplied.",
      },
      {
        id: "limitations",
        title: "Limitations and questions requiring expert review",
        body: "Executable experiments can reproduce a flawed procedure. Review must still assess assumptions, benchmark contamination, statistical validity, and whether the evidence supports the scope of the claim. The proposed protocol does not establish scientific truth automatically.",
      },
    ],
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  },
  {
    illustrative: true,
    id: "AST-003",
    title: "Reassessing color gradients in faint galaxies",
    field: "Astronomy",
    topic: "galaxy-evolution",
    status: "Published",
    summary:
      "An illustrative analysis design for separating radial color gradients from point-spread-function and sky-background effects.",
    updatedAt: "2026-10-03T07:40:00Z",
    version: "v1.0",
    reviewNote:
      "Illustrative publication record: a demo release is shown; no journal article, DOI, or real finding exists.",
    sections: [
      {
        id: "question",
        title: "Scientific question",
        body: "Illustrative example. Can a radial color gradient in a low-surface-brightness galaxy be distinguished from instrumental scattering and sky-subtraction errors? No galaxy sample or observed gradient is reported here.",
      },
      {
        id: "observations",
        title: "Observations and datasets",
        body: "The planned exercise uses simulated images in two photometric bands, empirical-style point-spread functions, and multiple sky-background realizations. A future observational study would need calibrated images and explicit sample selection. No files are uploaded.",
      },
      {
        id: "method",
        title: "Analysis method",
        body: "Measure radial profiles after matching the images to a common point-spread function. Propagate sky uncertainty across radial bins, then use injected galaxies to quantify bias in the recovered color gradient. Masking and radial ranges should be specified in advance.",
      },
      {
        id: "finding",
        title: "Proposed finding or interpretation",
        body: "The illustrative interpretation would consider stellar-population variation only for gradients robust to these systematic checks. The example does not establish a gradient or an evolutionary mechanism. Its Published badge represents a demo state only.",
      },
      {
        id: "evidence",
        title: "Supporting evidence and uncertainty",
        body: "Useful evidence would include injected-versus-recovered profiles, covariance across radial bins, and results under alternative sky models. Statistical error bars alone would be insufficient when extended point-spread-function wings are uncertain.",
      },
      {
        id: "alternatives",
        title: "Alternative explanations and outstanding checks",
        body: "Consider dust, age–metallicity degeneracy, unresolved background sources, scattered light, and selection effects. Additional bands or spectroscopic information would be needed to separate several competing physical interpretations.",
      },
    ],
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  },
];
