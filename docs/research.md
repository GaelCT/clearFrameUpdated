# Research reading list for ClearFrame's analysis backend

Compiled October 29, 2026. These are papers on detecting, locating, and correcting flaws in AI-generated video, grouped by the part of ClearFrame each one would help build. Titles and IDs were checked against arXiv pages for most entries; the rest come from search results.

Suggested first reads: DeeptraceReward, BrokenVideos, VideoHallu, VideoRepair, and VBench.

## 1. Finding and locating flaws (closest to ClearFrame's findings)

A ClearFrame finding has a category, a start and end time, and an optional box on the frame. These datasets label flaws the same way.

- **DeeptraceReward** ([arXiv 2509.22646](https://arxiv.org/abs/2509.22646)): 4.3K human annotations on 3.3K generated videos. Each one has an explanation, a bounding box, and start and end timestamps, grouped into 9 categories. Their 7B model beats GPT-5 by 34.7% on average. Getting timestamps right was the hardest task, harder than boxes or explanations. This is the closest match to ClearFrame's data model.
- **BrokenVideos** ([arXiv 2506.20103](https://arxiv.org/abs/2506.20103)): 3,254 generated videos with pixel-level masks of the damaged regions, checked by people. Use it to train and test spatial localization.
- **GenVID / DVAR** ([arXiv 2601.20297](https://arxiv.org/abs/2601.20297), Jan 2026): 80K videos labeled with 10 artifact categories across appearance, motion, and camera, plus a model that recognizes artifacts densely across each video. Its category list is worth comparing with ClearFrame's.
- **GeneVA** ([arXiv 2509.08818](https://arxiv.org/abs/2509.08818)): a large human-annotated set of artifacts that change over space and time, in videos made from natural prompts.
- **Skyra** ([arXiv 2512.15693](https://arxiv.org/abs/2512.15693), CVPR 2026): a multimodal model that points to visible artifacts as evidence, with localized cues. It is built for real-vs-fake detection, but the evidence-finding part carries over.
- **Artifact-Bench** ([arXiv 2605.18984](https://arxiv.org/abs/2605.18984)): tests how well current multimodal models identify artifacts. Useful when choosing which model to build on.

## 2. How far AI judges can be trusted

These support ClearFrame's rule that a person confirms each finding.

- **VideoHallu** ([arXiv 2505.01481](https://arxiv.org/abs/2505.01481), NeurIPS 2025): GPT-4o, Gemini 2.5 Pro, and Qwen2.5-VL miss physics and commonsense errors in generated videos. Targeted reinforcement-learning fine-tuning improves them.
- **ViBe** ([arXiv 2411.10867](https://arxiv.org/abs/2411.10867)): sorts errors in generated video into five types: Vanishing Subject, Numeric Variability, Temporal Dysmorphia, Omission Error, and Physical Incongruity. These map well onto ClearFrame's categories.
- **WorldJen** ([arXiv 2605.03475](https://arxiv.org/abs/2605.03475), May 2026): finds that yes/no question judging tends to answer "yes" too often and misses timing failures. It replaces this with graded questionnaires answered at the video's full resolution, and its rankings match human ones.

## 3. What to check: physics, prompt adherence, quality

- **VBench** ([arXiv 2311.17982](https://arxiv.org/abs/2311.17982)): 16 quality dimensions, including flicker, subject consistency, and motion smoothness. Its code is open source, so it's a practical starting point for measuring flicker and consistency.
- **VBench-2.0** ([arXiv 2503.21755](https://arxiv.org/abs/2503.21755)): adds human fidelity, controllability, physics, and commonsense.
- **VideoPhy-2** ([arXiv 2503.06800](https://arxiv.org/abs/2503.06800), ICLR 2026): physical commonsense across 200 actions. The best model scored only 22% on the hard subset.
- **Physics-IQ** ([arXiv 2501.09038](https://arxiv.org/abs/2501.09038), WACV 2026): compares generated videos against real footage of physics experiments, and finds that looking realistic doesn't mean the physics is right. Its scoring against real footage is relevant to ClearFrame's reference comparison.
- **T2V-CompBench** ([arXiv 2407.14505](https://arxiv.org/abs/2407.14505)): checks whether a video matches what the prompt asked for: attributes, spatial relations, counts, and actions. It combines model-based, detector-based, and tracking-based metrics. This is the basis for a script-adherence check.
- **VideoScore2** ([arXiv 2509.22799](https://arxiv.org/abs/2509.22799)) and **VideoReward** ([arXiv 2501.13918](https://arxiv.org/abs/2501.13918)): models trained on human ratings that score quality, prompt match, and physical plausibility. VideoScore2 also writes out its reasoning.

## 4. The correction loop (findings → corrected prompt → retake)

- **VideoRepair** ([arXiv 2411.15115](https://arxiv.org/abs/2411.15115), ACL 2026 Findings): detects where a video doesn't match its prompt, plans a fix, and regenerates only the wrong regions. It works with any generator and needs no training. This is the closest paper to ClearFrame's loop, but it is fully automatic.
- **VPO** ([arXiv 2503.20491](https://arxiv.org/abs/2503.20491), ICCV 2025): rewrites prompts to improve the video while keeping what the user meant.
- **RAPO++** ([arXiv 2510.20206](https://arxiv.org/abs/2510.20206)): refines the prompt for each video over several rounds, using feedback that includes optical flow.

## 5. Building blocks for measured detectors

ClearFrame already has a `measured-signal` origin for findings that come from direct measurement rather than a model's opinion. These tools would provide that.

- **SAM 2** ([arXiv 2408.00714](https://arxiv.org/abs/2408.00714)): segments and tracks objects through a video. If an object's mask vanishes without anything blocking it, that's appearance/disappearance. If the mask's shape changes, that's deformation.
- **CoTracker3** ([arXiv 2410.11831](https://arxiv.org/abs/2410.11831)): tracks points even when they're hidden. Points on a rigid object that drift apart signal deformation, and sudden jumps signal a motion problem.
- **SEA-RAFT** ([arXiv 2405.14793](https://arxiv.org/abs/2405.14793)): estimates motion between frames (optical flow) to catch motion jumps.
- **Lai et al., ECCV 2018** ([arXiv 1808.00449](https://arxiv.org/abs/1808.00449)): the standard warping-error measure of frame-to-frame consistency, which works for flicker.
- **Sapiens** ([arXiv 2408.12569](https://arxiv.org/abs/2408.12569)): human pose and body-part segmentation, for the anatomy check.

## Where ClearFrame might be new

Many groups are already working on detecting and locating flaws, so that part alone isn't new. What this search didn't find is a paper on the workflow ClearFrame is built around: a person confirms each finding, approves a versioned prompt correction, and checks on the retake that each confirmed flaw is fixed. VideoRepair closes the loop, but without a person checking. The search wasn't exhaustive, so a dedicated literature review could still turn something up.

The results above also support the current design. DeeptraceReward found timestamps the hardest thing for models to get right, and VideoHallu shows strong models missing obvious physics errors. Both argue for keeping a person in the loop to confirm findings.

---

The paper descriptions above are paraphrased from the sources to comply with licensing restrictions.
