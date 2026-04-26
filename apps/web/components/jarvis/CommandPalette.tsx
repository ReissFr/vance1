"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "./ToastHost";

async function fireAction(
  label: string,
  path: string,
  successTitle: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || body.ok === false) {
      throw new Error(body.error ?? `${label} failed`);
    }
    toast({ variant: "success", title: successTitle });
  } catch (e) {
    toast({
      variant: "error",
      title: `${label} failed`,
      body: e instanceof Error ? e.message : String(e),
    });
  }
}

type Command = {
  id: string;
  label: string;
  section: "Navigate" | "Action" | "JARVIS";
  keywords?: string;
  shortcut?: string;
  run?: (router: ReturnType<typeof useRouter>) => void;
};

const COMMANDS: Command[] = [
  { id: "nav-home", label: "Go home", section: "Navigate", shortcut: "H", run: (r) => r.push("/") },
  { id: "nav-today", label: "Today", section: "Navigate", shortcut: "T", keywords: "schedule day", run: (r) => r.push("/today") },
  { id: "nav-ops", label: "Operations", section: "Navigate", shortcut: "O", keywords: "approvals pending", run: (r) => r.push("/operations") },
  { id: "nav-watch", label: "Watchers", section: "Navigate", shortcut: "W", keywords: "rules ambient", run: (r) => r.push("/watchers") },
  { id: "nav-mtg", label: "Meetings", section: "Navigate", shortcut: "M", keywords: "calendar", run: (r) => r.push("/meetings") },
  { id: "nav-recall", label: "Recall", section: "Navigate", shortcut: "R", keywords: "search past semantic emails chats", run: (r) => r.push("/recall") },
  { id: "nav-search", label: "Search everything", section: "Navigate", keywords: "find query universal journal wins reflections decisions ideas questions knowledge prompts routines people themes policies predictions intentions standups reading commitments receipts subscriptions memories tasks tag", run: (r) => r.push("/search") },
  { id: "nav-mem", label: "Memory", section: "Navigate", shortcut: "E", keywords: "facts people preferences", run: (r) => r.push("/memory") },
  { id: "nav-inbox", label: "Inbox", section: "Navigate", shortcut: "I", keywords: "email drafts", run: (r) => r.push("/inbox") },
  { id: "nav-places", label: "Places", section: "Navigate", shortcut: "P", keywords: "location geofence", run: (r) => r.push("/places") },
  { id: "nav-sites", label: "Sites", section: "Navigate", shortcut: "S", keywords: "browser sessions", run: (r) => r.push("/sites") },
  { id: "nav-feat", label: "Features", section: "Navigate", shortcut: "F", run: (r) => r.push("/features") },
  { id: "nav-rcpt", label: "Receipts", section: "Navigate", shortcut: "C", keywords: "expenses spending", run: (r) => r.push("/receipts") },
  { id: "nav-bud", label: "Budgets", section: "Navigate", shortcut: "U", keywords: "spending limits", run: (r) => r.push("/budgets") },
  { id: "nav-sub", label: "Subscriptions", section: "Navigate", shortcut: "V", keywords: "recurring saas", run: (r) => r.push("/subscriptions") },
  { id: "nav-mny", label: "Money", section: "Navigate", shortcut: "Q", keywords: "spend waste savings dashboard", run: (r) => r.push("/money") },
  { id: "nav-cmt", label: "Commitments", section: "Navigate", shortcut: "B", keywords: "promises reminders", run: (r) => r.push("/commitments") },
  { id: "nav-cnt", label: "Contacts", section: "Navigate", shortcut: "D", keywords: "people counterparties profile directory", run: (r) => r.push("/contacts") },
  { id: "nav-hab", label: "Habits", section: "Navigate", shortcut: "J", keywords: "streaks daily routine check-in", run: (r) => r.push("/habits") },
  { id: "nav-focus", label: "Focus", section: "Navigate", shortcut: ".", keywords: "pomodoro timer do not disturb dnd deep work", run: (r) => r.push("/focus") },
  { id: "nav-read", label: "Reading", section: "Navigate", shortcut: ";", keywords: "read later link queue article save bookmarks", run: (r) => r.push("/reading") },
  { id: "nav-chk", label: "Check-ins", section: "Navigate", shortcut: "'", keywords: "energy mood focus mood daily rating tracker journal log", run: (r) => r.push("/checkins") },
  { id: "nav-intn", label: "Intentions", section: "Navigate", shortcut: "[", keywords: "daily intention focus today goal one thing carry forward", run: (r) => r.push("/intentions") },
  { id: "nav-dec", label: "Decisions", section: "Navigate", shortcut: "]", keywords: "decision log founder choice review right call wrong call alternative outcome", run: (r) => r.push("/decisions") },
  { id: "nav-bday", label: "Birthdays", section: "Navigate", shortcut: "\\", keywords: "birthday anniversary date reminder family friends gift", run: (r) => r.push("/birthdays") },
  { id: "nav-win", label: "Wins", section: "Navigate", shortcut: "=", keywords: "wins shipped sale milestone progress proof of motion celebrate", run: (r) => r.push("/wins") },
  { id: "nav-goal", label: "Goals", section: "Navigate", shortcut: "-", keywords: "goals quarterly monthly milestones target why ladder objectives okrs", run: (r) => r.push("/goals") },
  { id: "nav-idea", label: "Ideas", section: "Navigate", shortcut: "/", keywords: "ideas inbox shower thoughts what if angle product venture content brainstorm", run: (r) => r.push("/ideas") },
  { id: "nav-qst", label: "Questions", section: "Navigate", shortcut: "`", keywords: "questions open loops uncertainty research strategic customer technical answer", run: (r) => r.push("/questions") },
  { id: "nav-rfl", label: "Reflections", section: "Navigate", shortcut: "1", keywords: "reflections lessons regrets realisations gratitude observations journal retrospective learn", run: (r) => r.push("/reflections") },
  { id: "nav-lps", label: "Open loops", section: "Navigate", shortcut: "2", keywords: "loops open commitments questions ideas goals decisions dashboard aggregator threads attention what now", run: (r) => r.push("/loops") },
  { id: "nav-prm", label: "Prompts", section: "Navigate", shortcut: "3", keywords: "prompts saved library template recipe instruction reusable fire-by-name macro", run: (r) => r.push("/prompts") },
  { id: "nav-ppl", label: "People", section: "Navigate", shortcut: "4", keywords: "people crm relationships customers investors interactions reconnect network journal log who matters", run: (r) => r.push("/people") },
  { id: "nav-crd", label: "Knowledge cards", section: "Navigate", shortcut: "5", keywords: "cards facts quotes principles playbooks stats anecdotes definitions library reference atomic claim source", run: (r) => r.push("/cards") },
  { id: "nav-voi", label: "Brand voice", section: "Navigate", shortcut: "6", keywords: "voice tone style writer how I sound keywords avoid greeting signature sample email post message draft brand", run: (r) => r.push("/voice") },
  { id: "nav-stn", label: "Standup", section: "Navigate", shortcut: "7", keywords: "standup yesterday today blockers daily accountability journal log work check-in stuck", run: (r) => r.push("/standup") },
  { id: "nav-rtn", label: "Routines", section: "Navigate", shortcut: "8", keywords: "routines checklists steps procedures playbooks runbooks morning evening pre-meeting post-launch named ordered library walk-through", run: (r) => r.push("/routines") },
  { id: "nav-rtr", label: "Retrospective", section: "Navigate", shortcut: "9", keywords: "retrospective review week month synthesis recap timeline shipped learned decided stuck wins reflections decisions blockers intentions journal summary digest weekly monthly", run: (r) => r.push("/retrospective") },
  { id: "nav-thm", label: "Themes", section: "Navigate", shortcut: "0", keywords: "themes threads narrative arc story arcs current state ongoing focus what I'm living through paused closed active move launch build transition project work personal health relationship learning creative", run: (r) => r.push("/themes") },
  { id: "nav-pol", label: "Policies", section: "Navigate", keywords: "policies rules boundaries guardrails preferences enforce never always don't won't refuse decline scheduling spending finance health relationships work autopilot delegate house rules constraints", run: (r) => r.push("/policies") },
  { id: "nav-prd", label: "Predictions", section: "Navigate", keywords: "predictions forecasts bets wagers calibration confidence brier score odds tetlock superforecaster claim resolve hit miss accuracy track record", run: (r) => r.push("/predictions") },
  { id: "nav-rec", label: "Reconcile", section: "Navigate", keywords: "reconcile drift said vs did promises kept broken integrity audit accountability behind on overdue stalled stuck divergence reality check follow through what I haven't done", run: (r) => r.push("/reconcile") },
  { id: "nav-obs", label: "Inner monologue", section: "Navigate", keywords: "observations inner monologue notice noticed patterns contradictions blind spots growth encouragement questions things about me brain noticed insights what have you spotted self awareness mirror", run: (r) => r.push("/observations") },
  { id: "nav-pre", label: "Pre-mortems", section: "Navigate", keywords: "premortem pre-mortem failure modes risk what could go wrong stress test decision review kahneman watch list red team plausibility", run: (r) => r.push("/premortems") },
  { id: "nav-cf", label: "Counterfactuals", section: "Navigate", keywords: "counterfactual replay path not taken alternative what if regret validate other choice retrospective sliding doors decision twin simulate alternative", run: (r) => r.push("/counterfactuals") },
  { id: "nav-traj", label: "Trajectories", section: "Navigate", keywords: "trajectory projection forecast future self six months twelve months 6 month 12 month where am I heading project forward extrapolate if I keep going at this rate compounding what does next year look like", run: (r) => r.push("/trajectories") },
  { id: "nav-id", label: "Identity", section: "Navigate", keywords: "identity claims I am I value I refuse I'm becoming aspire who am I what do I value drift dormant contradicted retired self self-image personal constitution beliefs principles", run: (r) => r.push("/identity") },
  { id: "nav-fs", label: "Future self", section: "Navigate", keywords: "future self future-self talk to future me 6 months 12 months 5 years older me older self ask my future self what would future me say persona simulated chat dialogue conversation", run: (r) => r.push("/future-self") },
  { id: "nav-ps", label: "Past self", section: "Navigate", keywords: "past self past-self talk to past me 3 months 6 months 1 year 2 years 3 years younger me earlier self ask my past self what would past me say what was I thinking back then memory time machine former self prior version dialogue persona anchor date time travel", run: (r) => r.push("/past-self") },
  { id: "nav-cnst", label: "Constitution", section: "Navigate", keywords: "constitution living personal operating manual laws rules my own laws articles distilled values refusals identity policies version history v1 v2 versioned operating system how I work how I decide what I'm building manifesto declaration my own laws principles charter", run: (r) => r.push("/constitution") },
  { id: "nav-bel", label: "Belief vs behaviour", section: "Navigate", keywords: "belief contradictions hypocrisy clash drift alignment integrity check living my values stated values vs actions audit walk the talk practising what I preach value violations refuse violations broken commitments to self where am I drifting did I keep my word what am I contradicting myself on", run: (r) => r.push("/belief-contradictions") },
  { id: "nav-ic", label: "Inner council", section: "Navigate", keywords: "inner council voices of myself parallel ask my values self past self future self tired self wise self ambitious self deliberation multi-voice convene six voices council all of me hear from every side what does values me say what does tired me say what does ambitious me say synthesis having heard them all what do I think board of myself parliament chorus six perspectives", run: (r) => r.push("/inner-council") },
  { id: "nav-echo", label: "Echo journal", section: "Navigate", keywords: "echo journal echoes recurring patterns same loop have I felt this before said this before deja vu time travel semantic recall this reminds me of stuck pattern recurring frustration same insight in different words years apart you've been here before find echoes conceptual match self-mirror what have I written about this before similar entries from the past loops repetition same question different month", run: (r) => r.push("/echoes") },
  { id: "nav-mirror", label: "Self-mirror", section: "Navigate", keywords: "self mirror self-mirror snapshot description third person how do I appear how do I look right now describe me what's been going on with me drift over time compare me now to last month who am I being how am I showing up portrait reflection without advice mirror stream weekly mirror time-lapse identity portrait dated", run: (r) => r.push("/self-mirror") },
  { id: "nav-pm", label: "Postmortems", section: "Navigate", keywords: "postmortem postmortems decision review did this play out outcome verdict calibration prediction tracking right call wrong call hindsight check back on this remind me to revisit was I right was I wrong follow-up follow up scheduled review accountability track record predictive accuracy how good am I at predicting this how often am I right about my decisions look back on closed loop", run: (r) => r.push("/postmortems") },
  { id: "nav-soul", label: "Soul map", section: "Navigate", keywords: "soul map cartography graph identity architecture inner shape who am I right now load bearing tensions clusters anchors visual map of myself force directed graph constellation nodes edges values goals decisions themes policies people connections what supports what what's in tension what shapes what what's anchored to what draw a map atlas of self snapshot of my soul shape of who I am", run: (r) => r.push("/soul-map") },
  { id: "nav-prew", label: "Pre-write", section: "Navigate", keywords: "pre-write prewrite pre write draft journal for me reflection standup intention win check-in checkin invert blank page invert blank-page friction what would I write today fill the form for me draft my standup write my reflection draft an intention draft a win acceptance rate how often do I accept your drafts in my voice tone match drafts dashboard pre-fill prefill autocomplete journal autocomplete reflection autocomplete standup autocomplete intention autocomplete checkin", run: (r) => r.push("/pre-write") },
  { id: "nav-efc", label: "Energy forecast", section: "Navigate", keywords: "energy forecast predict tomorrow how will tomorrow feel mood focus prediction what will my day look like will I crash this week should I book deep work on friday low energy day high energy day forecasting myself self model body model calibration accuracy of forecasts predict next monday weekend energy day of week patterns same day pattern monday slump friday slump heavy decision drain meeting drain protect this push that schedule deep work window energy planning schedule based on energy", run: (r) => r.push("/energy-forecast") },
  { id: "nav-life", label: "Life timeline", section: "Navigate", keywords: "life timeline story arc chapters my life so far stitch my story narrative biography eras phases life chapters auto-detect chapters your life as a story how has my life unfolded life-timeline timeline of me autobiography pivots major decisions key moments chapters of my life what era am I in stitched timeline drift between stitchings re-stitch the timeline life-so-far book of me my life as a book story shape narrative arc grouped journal grouped reflections thematic eras", run: (r) => r.push("/life-timeline") },
  { id: "nav-tlet", label: "Time letters", section: "Navigate", keywords: "time letters letter to future self letter to past self letter from past self time-letters time letter sealed letter sealed envelope future me past me letter from january letter from 6 months ago letter to me-in-6-months write to my future self write to my past self past-self letter forward letter backward letter posterity letter time capsule sealed and delivered letter unlocks on whatsapp delivery message across time epistolary letter from me-then to me-now generate a letter from past-me what would past-me say what did I think back then voice from the past whatever future-me needs to know note to self future write a note to my future self", run: (r) => r.push("/time-letters") },
  { id: "nav-latent", label: "Latent decisions", section: "Navigate", keywords: "latent decisions decisions I made by default dark matter of self-knowledge stopped doing dropped abandoned drifted from what have I stopped doing what have I dropped friends I've stopped seeing habits I dropped projects I abandoned places I stopped going people I no longer text routines that vanished themes I stopped touching what's gone quiet in my life acknowledge contest dismiss materialise as decision two-window comparison drift detection things that disappeared from my life decisions by drift not by choice silent decisions implicit decisions undecided-but-decided invisible choices defaults shadow choices default-mode decisions latent-decisions latent decisions detector scan for latent decisions", run: (r) => r.push("/latent-decisions") },
  { id: "nav-rbrief", label: "Reverse brief", section: "Navigate", keywords: "reverse brief reverse-brief reverse engineer my day archaeology of belief implicit beliefs what does my day reveal I believe what was driving me today what was I really operating from gap between stated and actual identity action vs values shadow values implicit values implicit assumptions evidence based identity what my actions reveal contradiction between what I say and what I do what does today say I believe operating model belief audit end of day debrief belief debrief reverse engineering daily archaeology of self what was I treating as urgent what was I treating as important conflicts gap between identity claims and behaviour", run: (r) => r.push("/reverse-briefs") },
  { id: "nav-cself", label: "Counter-self chamber", section: "Navigate", keywords: "counter self counter-self chamber adversarial thinking strongest case against my position devil's advocate devils advocate steelman the opposite argue against me what would my failure-self say external skeptic concerned mentor smart cynic peer who's been there stress test my position challenge my decision attack my plan strongest counterpoint the line to sit with falsifiable predictions trip-wires position update engagement integration rebuttal five voices challenger voice failure timeline self future failure self what would I think if this fell apart smart cynic ego self-deception status games concerned mentor blind spots external skeptic outsider no skin in the game peer been there six steps further down the road stress my conviction tell me why I'm wrong make the case against argue the other side", run: (r) => r.push("/counter-self") },
  { id: "nav-pat", label: "Pattern library", section: "Navigate", keywords: "patterns pattern library causal patterns cause and effect what causes what in my data correlation sequence cluster threshold compound antecedent consequent what tends to precede what link between energy mood focus decisions blockers wins habits late nights low energy decisions reversed when I am tired wins on tuesday weekday concentration intention completion by energy bucket recurring blockers blocker recurrence statistical patterns lift support count strength hidden patterns find the patterns I am not seeing what does my data say about my decisions what does my data reveal show me my patterns scan my logs for cause and effect", run: (r) => r.push("/patterns") },
  { id: "nav-cloop", label: "Conversation loops", section: "Navigate", keywords: "conversation loops loops recurring questions questions I keep circling questions I keep asking what do I keep asking what am I circling on stuck question oscillation indecision loops dark matter of indecision should I focus on product or sales is the agency worth keeping am I a builder or operator should I commit or walk away mine my chats for patterns mine my messages for loops scan my conversations cluster my messages chat history pattern detection question shape topic shape recurring topic recurring theme name the loop resolve the loop write the answer step out of the loop receipts dated quotes sample quotes candidate exit step out", run: (r) => r.push("/conversation-loops") },
  { id: "nav-prom", label: "Promise ledger", section: "Navigate", keywords: "promise ledger promises self-promises self promises I will I'll starting Monday next week I'll I'm going to I need to I have to no more from now on I promise myself commitments to myself self trust kept broken broken promises kept promises self trust rate keep my word do I keep my word am I a person who keeps their word what have I committed to what have I promised what did I promise myself overdue promises pending promises re-promised re promised mine my chats for promises scan messages for commitments accountability self accountability self trust audit self trust mirror promise tracker", run: (r) => r.push("/promises") },
  { id: "nav-iv", label: "Inner voice atlas", section: "Navigate", keywords: "inner voice atlas voice critic dreamer calculator frightened soldier philosopher victim coach comedian scholar self talk how do I talk to myself who is speaking when I think who is speaking when I speak to myself dominant voice texture of self narrative self talk pattern voice mix voice distribution my critic my dreamer my fear my discipline my philosopher my victim my coach my humour my scholar inner monologue self-narrative atlas narrative dominant inner voice judging voice harsh voice planning voice scared voice grinding voice meaning voice helpless voice encouraging voice deflecting voice noticing voice mine my chats for self talk classify my self talk who lives inside my head", run: (r) => r.push("/inner-voice") },
  { id: "nav-phlb", label: "Phantom limbs", section: "Navigate", keywords: "phantom limbs phantom limb things I said I let go of but didn't things I claim to be over have I really moved on I'm done with I'm over I've moved on from I no longer think about I let go of I've stopped caring about I've put behind me that's in the past that ship has sailed I refuse to worry about I'm past it that chapter is closed move on claims unresolved unfinished business haunting score days since claim post mention count what I keep bringing up what I claim to have moved on from but keep mentioning the gap between words and body what my words let go but my body still carries broken move on claims actually carrying still mining my chats for things I said I'm done with phantom limb detector", run: (r) => r.push("/phantom-limbs") },
  { id: "nav-pivot", label: "Pivot map", section: "Navigate", keywords: "pivot map pivots pivoted change of direction direction change inflection point inflection moments turning points turning moments the moments I turned actually scrap that forget what I said new plan I changed my mind on reflection on second thought I was wrong about I've come round to let me reconsider rethink I'm dropping I'm killing I'm abandoning I'm pivoting U-turn I flipped 180 reset starting over fresh start verbal pivots stance reversals abandonments recommitments going back to properly this time seriously this time for real this time follow through back slide did I follow through did I slide back did I actually pivot did the pivot stick stuck pivot performed pivot reverted pivot vapour pivot mine my chats for pivots pivot detector turning detector", run: (r) => r.push("/pivot-map") },
  { id: "nav-quest", label: "Question graveyard", section: "Navigate", keywords: "question graveyard questions unanswered questions questions I never answered questions into the void self questions self-directed questions self questioning what am I avoiding answering what am I not answering what questions am I sitting on what big decisions am I sitting on what's hanging over me what's hanging in the air should I do I am I why do I why am I why can't I what should I do how do I how should I when do I where am I am I really am I just am I missing am I wrong is it just me is it worth decision questions self inquiry self-inquiry meta questions factual hypothetical rhetorical neglect score severely neglected long neglected ageing fresh quiet decisions I haven't made questions I've been asking into the void questions hanging unanswered things I've been wondering things I keep asking myself big questions little questions answer this answer this now I'll answer this mine my chats for self-questions surface unanswered questions question detector unanswered scanner what am I avoiding", run: (r) => r.push("/question-graveyard") },
  { id: "nav-mirror", label: "Mirror index", section: "Navigate", keywords: "mirror index mirror comparisons comparing myself self comparison self-comparison comparing yourself comparison patterns who am I comparing myself to who do I keep comparing myself to who do I measure myself against measuring stick benchmark past self old me when I was younger when I was 25 when I was 23 the version of me who I used to be old version of me previous self peer comparison everyone else other founders my friends are my peers are at my age by 30 by 35 founders my age people my age sibling parent comparison my brother my sister my dad my mum my mother my father my brother built my sister has my dad would have my mum did ideal self I should be the kind of person someone who has it together someone who I should be a person who I want to be someone who imagined future self future self I want to be the kind of person who I want to become downward comparison at least I'm not could be worse imagine being them at least I have I haven't fallen as low fairness score honest accounting cruel comparison apples to oranges unfair distorted self criticism self-criticism punishing comparison lifting comparison self lifting self punishing self-punishing reframe reframing fair reframe write a fair reframe acknowledge differences acknowledge starting points differences in luck timing pattern severity chronic measuring stick I'm so far behind miles ahead I should be further along everyone else is ahead I'm behind I haven't achieved I should have by now feeling like a failure feeling behind feeling stuck mine my chats for comparisons comparison detector mirror detector who I keep returning to who I keep measuring against the targets I keep returning to surface my comparison patterns chronic punishing pattern", run: (r) => r.push("/mirror-index") },
  { id: "nav-perm", label: "Permission ledger", section: "Navigate", keywords: "permission ledger permissions seeking authorisation authorization is it ok if is it alright if do you think it's ok to am I allowed to is it bad that I is it weird that is it wrong to is it selfish to is it stupid to I shouldn't but I shouldn't have to I shouldn't feel I shouldn't want I should be allowed to I deserve to do most people is this normal is this standard is it common to I'm probably going to but I'm gonna but pre emptive excuse future excuse what would my partner think what would my dad think what would my mum think what would my boss think will she mind will he hate this will the team be ok with am I crazy am I bad am I wrong I feel guilty about I feel weird about I feel bad about explicit permission justification self doubt comparison to norm asking the herd implicit authority audience inner critic self judge partner parent professional norm social norm friends work authority business boss client financial judge money judge abstract other generic ok seeking permission externalised authority externalized authority structural deference deferring giving away authority over my own choices chronic permission seeking I keep asking permission for grant yourself permission self permission grant self-permission grant I am allowed to I do not need permission write a self permission grant urgency score charged seeking hedged anxious framing fairness pattern severity who do I defer to who am I afraid will disapprove what am I asking permission for repeatedly mine my chats for permission seeking surface my permission patterns ledger detector authorisation detector authorization detector", run: (r) => r.push("/permission-ledger") },
  { id: "nav-erase", label: "Self-erasures", section: "Navigate", keywords: "self erasure self-erasure self erasures self-erasures register cancellation cancellations self cancellation cancelling myself overruling myself second voice the second voice the censor the editor inner editor self censorship self-censorship inner critic don't bother voice keep it light voice never mind nvm nm forget it forget I said anything forget I asked forget I mentioned forget what I wrote scratch that disregard ignore me don't mind me actually nothing actually never mind moving on moot point doesn't matter doesn't really matter probably nothing it's nothing nothing really small thing tiny thing not worth saying not worth mentioning forget I mentioned I'm fine never mind it's fine I'm being silly I'm being stupid I'm being weird I'm being dramatic I'm being needy I'm being annoying I'm being too much I'm being extra I'm being ridiculous I'm overthinking I'm overreacting I'm spiralling I'm catastrophising I'm rambling I'm venting sorry for venting sorry for rambling sorry for going on sorry for the rant sorry for the dump I was going to say I was about to say I almost said I almost asked I started to say I was thinking on second thought hmm never mind cancel my own thought thought cancellation what was I about to say what did I almost say what did I cancel feeling cancelled need cancelled request cancelled opinion cancelled what I erased restore the thought restore what I was about to say the don't be a burden voice the keep it light voice the calm it down voice the it doesn't matter voice the inner critic mine my chats for self erasures surface my self cancellations who keeps overruling me who keeps cancelling me who is the second voice my censor pattern severity reflex erasure entrenched censor habitual self deletion", run: (r) => r.push("/self-erasures") },
  { id: "nav-disowned", label: "Disowned register", section: "Navigate", keywords: "disowned register disownership disownerships identity disowning own my experience reclaim ownership reclaim it as mine the spectator the narrator the patient the observer the third person voice the case study voice the diagnostic voice describing my own life as someone else's distancing pronouns you know that feeling you ever feel like we all do this people get like that one feels someone in my position external attribution the depression hit anxiety took over the panic came back stress is doing this to me the rage spilled out the fear walked in burnout hit exhaustion hit the wave hit the storm came the cloud landed the darkness came back abstract body the chest tightens the stomach drops the throat closes the head spins the body shut down the legs gave out the heart pounds the breath stops tears came tears welled tears just fell sleep wasn't there appetite isn't there generic universal everyone has this everyone goes through this it's just life that's how it is that's how things are this is normal happens to everyone we all go through this nothing special about it it's common doesn't happen to just me agentless passive the gym wasn't visited the message didn't get sent the email never went out the call wasn't made nothing got done today the day got wasted the morning got lost things didn't get finished work didn't happen reclaim it as yours i form active voice rewrite say it as I in active voice describe yourself as the subject own your experience grammatically own your feelings own your body name yourself as the actor mine my chats for disownership scan for disownership pattern severity reflex disowning entrenched spectator habitual self removal", run: (r) => r.push("/disowned") },
  { id: "nav-mind-theatre", label: "Mind theatre", section: "Navigate", keywords: "mind theatre theater convene the panel panel meeting council inner council roundtable inner roundtable ask the cabinet what would the voices say convene voices convene the cabinet panel of voices gather the voices summon the voices speak in character voices speak each voice replies voices in panel inner family parts work parts dialogue parts conversation IFS sit with sitting with i'm sitting with i'm wrestling with i can't decide should i shouldn't i i don't know if i should torn between part of me wants but another part i should but i don't want to i want to but i feel guilty i'm not sure whether to is it ok if i is it bad if i is it weird if i should i take it should i go should i say yes should i say no should i decline should i accept should i quit should i stay should i leave should i message him should i call her should i ask out the panel says mum says dad says inner critic says founder says my partner would say money judge says future self says past self says stance push pull protect caution ambivalent vote vote on this question voice's vote vote on a decision i went with mum's voice i went with the inner critic i went with my partner's voice override the panel write your own answer self authored answer override everyone i'm overriding ignore the voices silence a voice silence the inner critic silence mum's voice silence dad's voice not on this one not on this question not this time refuse a voice's vote take authority on this specific question externalise the noise externalize the noise externalise the internal noise see all the voices at once panel of inner voices panel of internal voices council meeting inner council meeting cast meeting inner cast meeting decision panel decision theatre dilemma session sit with the panel sit with the dilemma name the question name the dilemma name the choice ask the inner cast resolution mode went with self authored silenced unresolved sitting with it the dilemma session new mind theatre session start a session", run: (r) => r.push("/mind-theatre") },
  { id: "nav-cabinet", label: "Voice cabinet", section: "Navigate", keywords: "voice cabinet voices in your head inner voices the voices the cast inner family parts work parts inner critic parental voice parent voice mum's voice mother's voice dad's voice father's voice partner's voice partner voice founder voice operator standard professional norm social norm generic society money judge financial judge frugal voice past self future self mentor diffuse other abstract other build the cabinet the cabinet who is in my head whose voice keeps showing up who is running me who authors my shoulds the loud voices in my head airtime score influence severity acknowledge integrate retire retire it retire this voice take authority back integrate the wisdom keep the wisdom leave the pressure self authorship self-authorship author my inner cast inner cast cast of voices internal family systems IFS parts work psychotherapy adjacent name the voice name whose voice this is parental introject internalised parent internalized parent absorbed standard absorbed norm hand back the standard hand back the should i don't endorse this i didn't sign up for this this isn't my standard this isn't mine this is my mum's standard this is my dad's standard this is hustle culture this is just society this is what people are supposed to do hand back the demand cabinet console synthesise voices synthesise the cabinet aggregate voices aggregate from shoulds whose voice puts shoulds in my head pattern of attribution build the cabinet build cabinet refresh cabinet rescan cabinet", run: (r) => r.push("/cabinet") },
  { id: "nav-shoulds", label: "Should ledger", section: "Navigate", keywords: "should ledger shoulds the should ledger unmet obligations unmet self mandates self-mandates oughts musts have to needs to supposed to gotta i should i shouldn't i ought to i need to i have to i must i'm supposed to i was supposed to i'm meant to i should be more patient i should be more present i should be kinder i should call her i should call my mum i should text him back i should reach out i should reply i should email i should sort that i should fix that i should finish that i should tidy that i should book that i should eat better i should sleep better i should drink less water i should stop drinking i should stop smoking i should go to bed earlier i should see a gp i should see a doctor i should see a therapist i should exercise more i should run again i should go to the gym i should stretch i should meditate i should journal i should be the kind of person who i should be someone who i should be more disciplined i should work harder i should ship faster i should reply to that client i should send that email i should save more i should stop spending i should budget i should cancel that subscription i should pay off i should invest moral oughts practical chores social call backs relational debts health resolves identity demands work pressures financial morals obligation source whose voice put this should there self own value parent voice partner voice inner critic social norm professional norm financial judge abstract other charge score guilt charged guilt saturated guilt tinged feel bad guilty keep meaning to been meaning to haven't got round to never get round to disappointing letting them down letting myself down release valve release it as not mine bring it back as a promise convert it to a promise do it done already handled noted dismissed pinned archived release this isn't mine to carry this isn't my standard whose voice is this whose values are these am i carrying someone else's should chronic should entrenched ought guilt list self authorship self-authorship inventory of obligations the things i keep telling myself i should mine my chats for shoulds scan for shoulds surface my unmet obligations surface my oughts what voices keep showing up whose voice puts most shoulds in my head", run: (r) => r.push("/shoulds") },
  { id: "nav-used-to", label: "Used to", section: "Navigate", keywords: "used to register lost selves past selves who I used to be what I used to do hobbies I stopped habits I dropped capabilities I lost people I no longer talk to places I left identities I shed beliefs I outgrew roles I handed back rituals I broke i used to draw i used to paint i used to write i used to read i used to sing i used to dance i used to play guitar i used to play piano i used to cook i used to bake i used to garden i used to run i used to swim i used to cycle i used to knit i used to sew i used to build i used to make things i used to journal i used to meditate i used to wake up early i used to go to bed early i used to be sharp i used to be focused i used to be patient i used to be calm i used to be disciplined i used to be creative i used to be sociable i used to be more focused i used to be able to focus i used to be on top of things i used to be more productive i used to talk to her i used to talk to him i used to call mum i used to message him every day we used to hang out we used to talk every day i used to live in london i used to live in new york back when i lived in i used to be a writer i used to be an artist i used to be a runner i used to be the kind of person who i used to think of myself as i used to be someone who shipped fast i used to be that guy i used to believe i used to think i used to trust i used to assume i used to expect i used to manage i used to run that team i used to host the dinner every sunday i used to call mum every saturday i used to long for it back miss it those days the good old days nostalgic nostalgia what i lost what i gave up the version of me who lost selves inventory mourning lost identity longing reclaim it bring it back schedule it again grieve it let it go bring back drawing put drawing on the calendar pick it up again restart it scan for used to mine my chats for lost selves what have i mourned what do i miss most who do i miss what hobbies have i dropped what have i let go what version of myself am i mourning chronic mourning entrenched longing", run: (r) => r.push("/used-to") },
  { id: "nav-loops-register", label: "Loops register", section: "Navigate", keywords: "loops register loops record register of loops what i keep coming back to what i keep returning to what i keep circling around recurring concerns recurring questions recurring fears recurring thoughts recurring scenes recurring grievances recurring cravings recurring regrets the same thoughts again and again same questions same fears the same loop the same loop again the loop i keep getting stuck in the loop i can't get out of the thought i keep returning to the question i keep asking the fear i keep replaying the scene i keep replaying the conversation i keep replaying the moment i keep replaying chronic thoughts chronic worries chronic fears chronic questions chronic loops chronic concerns ongoing concerns ongoing questions ongoing fears ongoing patterns mental loops thought loops emotional loops mind loops what is on a loop in my head what is looping what's looping what i keep ruminating about ruminating rumination repetitive thoughts repetitive worries repetitive fears repetitive questions question loop fear loop problem loop fantasy loop scene replay loop grievance loop craving loop regret loop regret_gnaw the regret that gnaws the gnawing regret what gnaws at me what nags me what's been nagging me what has been on my mind for months what has been on my mind for years should i quit my job should i leave should i stay should i message her should i text him whether to have kids whether to move whether to quit replaying the call replaying the conversation replaying the fight what they said what i should have said i keep wanting i keep craving i keep wishing i'd i keep wishing i had what dad would think missing my dad missing mum the thing i never said the thing i regret time-weighted recurrence chronicity how long i've been stuck on this how long this has been live how long this loop has been alive velocity escalating stable dampening dormant escalating loop stable loop dampening loop dormant loop loop is escalating loop is settling down getting worse getting better fading first seen last seen occurrence count distinct chats amplitude intensity passing present weighted heavy searing how heavy is this loop how big is this loop how loud is this loop break the loop end the loop close the loop widen the loop reframe the loop introduce new information settle the loop accept the loop accept it as care this is care not a problem to fix this is the shape of love now ongoing care not a problem to solve archive the loop dismiss the loop unresolve the loop pin the loop loops dashboard loops console mine my chats for loops scan for loops scan loops what loops am i in what loops am i stuck in what's been bothering me for ages what's been on a loop what's chronic what's escalating where am i looping what mental patterns what recurring patterns what themes do i keep returning to what do i keep circling back to what is unresolved what won't go away meta pattern over utterances pattern of recurrence diagnostic of mind", run: (r) => r.push("/loops-register") },
  { id: "nav-fears", label: "Fears", section: "Navigate", keywords: "fears fear ledger fear-ledger fear register the fears i've articulated the fears i carry what i'm afraid of what i'm scared of what i worry about what i'm worried about what scares me what terrifies me what frightens me i'm afraid that i'm afraid of i'm scared that i'm scared of i'm terrified that i'm terrified of i'm worried that i'm worried about i'm fearful that i'm anxious about i'm nervous about i fear that i fear i worry that i worry i dread i dread that what if what if i what if she what if he what if they what if it what if this what if that my biggest fear is my worst fear is my deepest fear is biggest fears worst nightmare nightmare scenario worst case scenario worst case my biggest worry my biggest worries it scares me that it terrifies me that it frightens me that scared that scared of afraid that afraid of terrified that terrified of i keep having this fear i keep having the fear that i keep getting this fear i keep worrying about i can't stop worrying about i can't stop thinking about it keeps me up at night keeps me awake at night keeps me up at night thinking about wakes me up worrying in the back of my mind i'm dreading i'm panicking about i'm losing sleep over i lie awake worrying it's terrifying it's frightening i have a fear i have a worry i have a dread i have this dread i'm full of dread sense of dread feeling of dread weight of fear fear weighs on me what happens if what if it goes wrong what if it falls apart what if i lose what if i fail what if i'm not enough what if they leave what if they reject me what if i'm wrong what if i can't do this what if i can't handle this what if it's all a mistake catastrophising catastrophizing catastrophic thinking everything will fall apart it'll all fall apart everything is going to go wrong abandonment abandonment fear they will leave they'll leave he'll leave she'll leave they will cut me off he will cut me off she will cut me off rejection rejection fear they will say no he will say no she will say no they will pull away she will pull away they won't pick me they won't choose me failure failure fear i'll fail i will fail i can't do this i won't be able to i can't handle this loss loss fear i'll lose i will lose i'll lose them i'll lose this i'll lose the deal i'll lose the money i'll lose my mind shame shame fear they'll see me they will see what i really am they'll find out i'll be exposed they'll know i'm a fraud they'll think i'm imposter syndrome i'm not enough i won't be enough i'm not good enough inadequacy inadequacy fear loss of control losing control i can't control this i won't be able to control mortality death dying illness serious illness i'll get sick i'll die future uncertainty uncertain future the unknown the future scares me i don't know what's coming charge intensity bending behaviour fear bending behaviour visceral fear charge 5 charge 4 felt intensity domain relationships work money health decision opportunity safety self unknown novel diagnostic fear realisation rate fear realization rate fear-realisation-rate fear realisation realisation rate empirically empirical how often do my fears come true how often does my fear actually realise how often does my worry come true how accurate are my fears am i a catastrophiser am i catastrophizing how prophetic are my fears empirical record of my alarm system inner alarm system alarm calibration calibrate my fears measure my fears overrun rate fear overrun cognitive bandwidth on fears that don't realise wasted bandwidth wasted cognitive bandwidth most realised kind least realised kind most prophetic fear flavour least prophetic fear flavour most accurate fear least accurate fear realised actually happened my fear was right the feared event happened it actually came true partially_realised partially realised some of it happened some came true some didn't dissolved fear dissolved fear didn't happen fear was wrong overrun the fear was bandwidth overrun nothing happened never came true thank god displaced displaced fear didn't happen but replaced by another the underlying pattern is still there same pattern different fear unresolved still unfolding outcome pending dismiss false positive dismissed false positive resolve fear pin fear archive fear should i be worried about this is this worry worth listening to is this fear worth listening to should i listen to this fear is my catastrophising right is my abandonment fear right is my rejection fear right is this catastrophising or real should i act on this fear how often have i been right when i feared this how often was i right is this kind of fear usually right which kinds of fears are right which kinds of fears are wrong personal calibration about fears my fears compared with reality my fears vs reality fears vs reality measured against what came reality check on my fears chronic catastrophiser chronic worrier chronic anxiety articulate fear pre-articulated fear fear vs gut fear is articulated fear is a future claim mine my chats for fears scan for fears find my fears surface my fears what fears am i carrying what have i been afraid of lately what have i been worrying about how often do my fears come true scan fears mirror to gut checks ledger of articulated fears empirical alarm system measurement against the world outcome empirical fear data calibrate the alarm bell pairs with gut checks empirical inner alarm system gut accuracy and fear realisation together", run: (r) => r.push("/fears") },
  { id: "nav-gut-checks", label: "Gut checks", section: "Navigate", keywords: "gut checks gut-checks gut feeling gut feelings gut signals my gut my gut says my gut tells me my gut told me my gut said my gut is telling me my gut is screaming my gut is screaming at me a gut feeling gut feeling about gut sense gut check gut-check sixth sense intuition my intuition trust my gut trust my intuition is my gut reliable how often is my gut right how often am i right when something feels off something feels off something feels wrong something feels right something doesn't feel right something doesn't sit right something tells me something tells me to something tells me not to i just know i just knew i can just tell i can sense it i sense something something seems off something seems weird something seems fishy something is off something is wrong something is right i had a feeling i had a bad feeling i had a good feeling i have a bad feeling i have a good feeling bad feeling about good feeling about weird feeling about funny feeling about strange feeling about uneasy feeling i'm getting weird vibes i'm getting bad vibes i'm getting good vibes i'm getting weird vibes from off vibes weird vibes bad vibes funny vibes uneasy vibes hunch a hunch i have a hunch inkling i have an inkling nagging feeling nagging suspicion nagging thought can't put my finger on it can't quite put my finger on it i can't put my finger on it but i don't know why but it just feels deep down i know in my bones i know in my gut i know in my chest i know in my stomach i know my chest is tight my stomach drops something inside me says something inside me told me everything in me is screaming something in me is screaming i picked up something doesn't feel like a yes doesn't feel like a no feels like a yes feels like a no feels right feels wrong feels off feels too good feels too easy feels forced feels fishy seems too good to be true sus sus feeling sus vibe pattern recognition below conscious analysis felt signal without articulated reason without a reason can't explain why i don't know why but the felt signals before the reasons signal kind warning pull suspicion trust unease certainty dread nudge hunch warning signal pull signal suspicion signal trust signal unease signal certainty signal dread signal nudge signal hunch signal directional pull subtle pull subtle nudge speculative guess held with conviction novel diagnostic gut accuracy rate gut accuracy how accurate is my gut how reliable is my gut empirical empirically measured how often does my gut turn out right gut calibration calibrate my gut calibrate my intuition gut trust rate trust calibration quadrant quadrant matrix the quadrant the 2x2 the 2x2 matrix followed gut and right verified right vindicated trusted my gut and was right followed gut and wrong verified wrong costly trusted gut and was wrong didn't follow and right ignored regret i knew it i should have listened i should have trusted my gut the i knew regret didn't follow and wrong ignored relief glad i didn't follow my gut glad i overrode glad i didn't listen the brake worked unresolved still unfolding outcome pending dismiss false positive scan novel architecture a 2x2 distribution mapping followed gut to outcome followed gut times gut was right empirical record of intuition reliability personal calibration epistemics about my own intuition how much should i trust my gut on what kinds of things which signal flavours do i get right which signal flavours do i get wrong most reliable signal least reliable signal most reliable kind of gut feeling least reliable kind chronic gut overrider chronic gut over-trusty chronically over-trusts gut chronically over-rides gut domain relationships work money health decision opportunity risk self unknown the new investor the new client this deal won't close this move is right the partnership the contract the second interview should i take this should i go for it should i sign should i decline am i right to feel am i overreacting am i being paranoid am i being suspicious am i being too trusting am i being naive should i listen to my gut should i override my gut something is bothering me about this something is bothering me but i can't say why my gut is screaming pre-conscious signal pattern matching beneath cognition pattern recognition before reason what was my gut telling me last year what did my gut say about that calibrate myself empirically about my own intuition mine my chats for gut signals scan for gut feelings find my gut signals surface my felt signals surface my hunches", run: (r) => r.push("/gut-checks") },
  { id: "nav-owed-to-me", label: "Owed to me", section: "Navigate", keywords: "owed to me owed-to-me ledger register the promises others made me promises owed to me what others said they'd do what others promised me what i'm waiting on what i'm waiting for who hasn't got back to me who hasn't responded who hasn't replied who never followed up who never followed through she said she'd he said he'd they said they'd they were going to they were gonna she promised he promised they promised dad said he'd mum said she'd my dad said he'd my mum said she'd my partner said my partner promised my brother said my sister said my mate said my friend said sarah said tom said my colleague said my boss said the contractor said the builder said the plumber said the electrician said the gp said my doctor said my landlord said my agent said the consultant said still waiting still waiting on still waiting for still hasn't sent still hasn't replied still hasn't got back still hasn't come back still hasn't done it still hasn't finished he hasn't replied she hasn't replied they haven't replied yet to hear yet to come back yet to send hasn't gotten back hasn't reached out supposed to come supposed to send supposed to reply supposed to deliver supposed to drop supposed to be done by supposed to get back to me supposed to let me know was meant to was supposed to never heard back never got back to me never sent it never replied haven't heard from waiting on him waiting on her waiting on them waiting on sarah waiting on the contractor waiting on the consultant waiting on a reply waiting on a response by tomorrow by tonight by friday by monday by the end of by next week by this weekend gonna send gonna drop gonna do gonna let me know going to send going to drop going to do going to come unkept promises broken promises unfulfilled promises pending promises outstanding promises promises i'm carrying carrying promises silent promises hidden promises invisible cognitive load cognitive load real cognitive overhead the weight of waiting waiting silently waiting forever waiting indefinitely the relationship who promised relationship_with relationship who's making the most unkept promises whose word can i count on who delivers who follows through follow-through who follows through follow through received follow-through received did they actually deliver does she actually deliver does he actually deliver does my partner actually do what they say does my boss actually deliver follow through rate per relationship calibration cross tab cross-tab on relationship who's quietly taking up your bandwidth quiet bandwidth bandwidth taken up by waiting bandwidth eaten cognitive overhead of unfulfilled promises chronic non-followthrough chronic non-follow-through chronic flake unreliable people unreliable colleagues unreliable contractors unreliable family novel diagnostic field relationship category partner parent sibling friend colleague boss client stranger unknown stranger contractor gp dentist plumber novel resolution raised raise it bring it up brought it up name the unmet promise made the conversation refuse the binary of waiting forever or burning it down convert silent weight to real exchange transfer cognitive weight transfer the weight from your head into a real exchange raised outcome they followed through they apologized they apologised they explained they dismissed it no response after raising kept they did the thing the boiler got fixed they delivered marking kept broken they explicitly didn't they declined they backed out they cancelled they canceled forgotten they probably forgot they slipped my mind they got busy released let it go release the wait stop expecting it stop carrying it dismiss false positive scan didn't actually mean a promise reschedule push the deadline target_date overdue due today due this week due this month load bearing load-bearing significant chunk of life gated on this person doing what they said horizon today tomorrow this week this weekend next week this month next month soon eventually unspecified spoken_date target_date who's been waiting on what i'm waiting for who hasn't got back to me what's overdue what's the contractor doing where's the boiler did sarah send the files did mum send the photos did dad send the money what i should chase what i should chase up follow up i need to follow up should i follow up should i bring it up should i raise it should i mention it should i text them again do my colleagues actually deliver who's the most reliable in my life who flakes on me most often who's chronically late chronic flake one specific person who is quietly taking up my bandwidth who is letting me down quietly who is letting me down without me noticing who has the highest follow-through who has the lowest follow-through promises owed to me ledger of promises owed reverse said i would inverse said i would mirror said i would inverse mirror reverse mirror clean inverse mirror promises BY me vs promises TO me promises BY them work health relationships family finance creative self spiritual scan owed to me find what's owed to me mine my chats for reported promises surface my unfulfilled promises i'm carrying find what i'm waiting on", run: (r) => r.push("/owed-to-me") },
  { id: "nav-permission-slips", label: "Permission slips", section: "Navigate", keywords: "permission slips permission-slips ledger register the things i refuse myself the things i can't do the things i won't let myself do i can't i can not i'm not allowed to i shouldn't be i shouldn't even i shouldn't really it's not for me it's not allowed for me not for someone like me i'm not the kind of person who i'm not the type who i don't get to i don't deserve to who am i to i have to earn it i have to prove i have to wait i have to push through i can't justify i can't really afford to i can't rest until i'd feel guilty if i'd feel selfish to i'd feel wrong to negative self constraints negative self-constraints things i forbid myself self forbidding self-forbidding self denial self-denial blocks blockers self imposed limits self-imposed limits limits on myself constraints i place on myself why can't i why can i not why won't i let myself why don't i let myself why am i not allowed why am i refusing myself the signer who's holding the pen who would have to grant permission who's the authority signer signer field whose permission do i need who's signing this slip who's signed it implicit signer implicit authority external signer external authority parent signer parent authority partner signer partner authority peers signer peers authority society signer society authority employer signer employer authority profession signer profession authority circumstance signer circumstance authority self signer unknown signer my dad never let us my mum would think my partner would mind my friends don't do that nobody at my office does people in this field don't real X don't do Y rules of investment journalism rules of the industry rules of my family rules my parents made the unspoken rules the silent rules cultural script social script cultural norm social norm internalised parental voice internalized parental voice absorbed standard absorbed norm material constraint mortgage kids school money tight i can't afford to time i don't have the time circumstance authority real constraint legitimate constraint not real not legitimate illegitimate authority sign it yourself signed by self self signed self-signed give yourself permission grant yourself permission permission grant the permission you're granting yourself i give myself permission to i am giving myself permission to refuse the assumption that someone else needs to grant authority back take authority back novel resolution re sign re-sign re-signed accept the constraint accept eyes open eyes open accept with eyes open accept the constraint with eyes open name the legitimate reason this is real this is fair this holds this holds for now refuse refuse the slip refuse the authority the slip isn't real the authority is illegitimate that's not mine to carry that was my mum's rule not mine i'm done with it i'm done answering to that done with it dismiss false positive scan didn't actually mean i can't reckon with whose voice this is name the signer surface the signer surface the implicit authority half the diagnostic is naming the signer most slips have an external signer noticing what i refuse myself work health relationships family finance creative self spiritual ledger of refusals ledger of self denial register of self-denial register of self denial register of refusals scan permission slips mine my chats for permission slips surface my permission slips find what i refuse myself who am i answering to who's keeping me small what's keeping me small what am i refusing myself what do i keep saying i can't do what blocks am i carrying load bearing slip load-bearing slip identity-level slip identity-level refusal", run: (r) => r.push("/permission-slips") },
  { id: "nav-contradictions", label: "Contradictions", section: "Navigate", keywords: "contradictions ledger contradictions register where i contradict myself where am i inconsistent inconsistencies cross-time pairs contradictory statements two things i said two statements that disagree i said one thing then i said another i said x then i said not-x said one thing said another conflicting positions conflicting statements conflicting beliefs changed my mind have i changed my mind have i drifted have my views drifted has my position changed has my stance changed have i moved on flip-flop flip flop flipped my position changed my stance changed my view did a u-turn u-turn 180 do i contradict myself walt whitman 'do i contradict myself very well then i contradict myself i am large i contain multitudes' i contain multitudes both can be true two truths held two truths can hold dual truths the dual resolution refused binary refuse the binary not either-or both/and both and at the same time depending on context depending on mood depending on phase depending on life-phase context dependent context-dependent multifaceted i'm multifaceted i'm not inconsistent i'm multifaceted growth narrative growth genuine evolution position evolution evolution evolved past self the past me the older me the younger me identity contradiction belief contradiction value contradiction commitment contradiction desire contradiction preference contradiction appraisal contradiction reckon with my own words check my own statements check what i've said before audit my statements audit my words pull pairs from chat history days apart days unreconciled how long has this stood unreconciled longest unreconciled longest standing contradiction load-bearing contradiction load bearing contradiction identity-level contradiction the contradiction at the heart of who i am where i'm conflicted where am i conflicted what's the gap between what i say what i think i believe vs what i actually believe public stance vs private stance posturing performances performance both performances neither current neither true anymore moved past both moved past i've moved past evolved over time changed over time my position has changed my position has evolved confused i don't know which i don't know which holds i don't know if i'm one or the other i flip flop i go back and forth i go back and forth between believing two things genuinely undecided undecided unresolved alive contradiction live contradiction unanswered question of self mine my chats for contradictions scan for contradictions find contradictions find inconsistencies surface contradictions surface inconsistencies relational extraction pairs across time pairs over time across time across the chat history paired statements", run: (r) => r.push("/contradictions") },
  { id: "nav-said-i-would", label: "Said I would", section: "Navigate", keywords: "said i would said i'd said-i-would ledger casual promises tiny promises everyday promises promises in passing promises i made offhand offhand promises offhand commitments little promises minor promises promises i forgot promises i made and forgot what did i say i'd do what have i promised what have i said i'd what did i say i would what have i committed to what do i owe what do i owe people what's overdue what's due what's due today what's due this week what's due this month what's coming up what's outstanding what did i promise her what did i promise him what did i tell them i'd do what did i tell mum i would do i'll do it i'll send that i'll send it i'll send him i'll send her i'll get back to you i'll let you know i'll fix it i'll sort it i'll handle that i'll deal with that i'll book it i'll book that i'll call her i'll call him i'll call you i'll call mum i'll call my mum i'll text her i'll text him i'll message i'll reply i'll respond i'll email i'll write back i'll think about it i'll get round to it i'll get around to it i'll do it tomorrow i'll do it later i'll do it this weekend i'll do it next week i'll do it this week i'll do it this month i'll do it next month i'll be there i'll be on time i'll show up i'll start tomorrow i'll start monday i'll start next week i'm going to i'm gonna let me check let me sort it let me handle it let me get back to you tomorrow i tomorrow i'll this weekend i'll next week i'll horizon today tomorrow this week this weekend next week this month next month soon eventually unspecified target date overdue due today due this week due this month follow through follow-through follow through rate kept partial broken forgotten dismissed broke my promise i broke my promise i forgot completely forgot i totally forgot didn't get round to it didn't get around to it didn't have time slipped my mind clean forgot ran out of time changed my mind decided not to thought better of it wasn't right anymore not gonna do it i'm not going to didn't end up doing it never got to it never did it half did it sort of did it kind of did it partial did some did most i did the thing i did it i kept my word kept my promise commitment calibration follow-through calibration broken vs forgotten chronic forgetting chronic non-commitment forget rate broken rate kept rate per domain per horizon work health relationships family finance creative self spiritual reschedule push it back move it forward extend the deadline pin pinned promises archive ledger of promises ledger scan promises mine my chats for promises surface my promises surface what i said i'd do how good am i at following through where do i break my promises how often do i forget what's the thing i keep saying i'd do but never do am i a tomorrow person am i a next-month person", run: (r) => r.push("/said-i-would") },
  { id: "nav-letters", label: "Letters across time", section: "Navigate", keywords: "letters across time letter to my future self letter to future self letter to my past self letter to past self letter to my younger self letter to younger self letters to myself letter to me dear me dear future me dear past me dear younger me time capsule time capsules time capsule for my future self leave a letter for myself leave a message for myself open this in a year open this when open me on open in 5 years open in one year delivered on its date the day i wrote this who i was when i wrote this who i was back then who you were when you wrote this who you were back then state vector snapshot state-vector snapshot snapshot of who i am now snapshot of who i was inferred state inferred snapshot proof of who i was archive of self correspondence self correspondence self-correspondence epistolary archive write a letter to my younger self write a letter to my future self write a letter to who i was write a letter to who i'll be address my past self address a younger me address future me to me at 18 to me at 21 to me at 25 to me when i quit to me on the day i to me before to me after to me the year i scheduled letter delivered letter pinned letter prompt question what would i want her to know what would i want him to know what would i tell my younger self if i could what i would tell my future self compose a letter compose letter send across time slow burn message future delivery deliver on a date deliver in a year deliver in five years deliver next year next scheduled letter due date most recent delivered letters list of letters letters i have written my letters", run: (r) => r.push("/letters") },
  { id: "nav-vows", label: "Vow ledger", section: "Navigate", keywords: "vow ledger vows promises to myself promises-to-self self-authored rules constitutional review of the self constitutional review the constitution i wrote for myself promises i made to myself i always i never i promised myself i told myself i would i told myself i'd never i swore i would i swore i would never i swore i'd never never again rule i have for myself rule i made for myself rules i live by my rules my code my code of conduct on principle as a matter of principle a matter of principle i made a deal with myself i made a pact with myself pact with myself oath i took oath to myself i committed to i decided long ago i decided years ago since i was a kid i'm the kind of person who never i'm the kind of person who always the kind of person i am i'm not the kind of person who i don't do that i don't tolerate that childhood vow childhood promise teenage vow adolescent vow vows from childhood vows from when i was a kid old vows old promises lifelong rules lifelong promise vow age childhood adolescent early adult adult recent unknown unexamined vow unexamined promise unreviewed vow vow i never reviewed shadow what this vow forecloses what this vow rules out what i never let myself do what i never allow what i never permit the cost of this vow the shadow of this vow what i'm not allowing because of this what i refuse what i won't do every always implies a never every never implies an always positive commitment shadow side downside cost of the vow what it costs me what it forecloses origin event the moment i made this vow when i first made this vow the day i decided where this vow came from where this rule came from when did i first say this when did i first decide this weight passing rule organising principle organizing principle identity-level vow load-bearing vow most load-bearing vows that run my life unexamined commitments my unexamined commitments lurking commitments hidden commitments operating principles renew renew the vow re-author the vow re-author keep this vow it's still mine it still holds revise revise the vow update the vow same spirit different shape spirit of the vow letter of the vow new vow text replace the old vow release release the vow let it go let the vow go what this vow protected what this vow protected me from why i no longer need this protection it belonged to a past self the kid who needed this rule honour honour the cost of the vow honor honour the vow keep but acknowledge cost name the cost name the shadow keep with eyes open keep without illusion dismiss false alarm work health relationships family finance creative self spiritual scan vows mine my chats for vows surface my vows surface my promises to myself what have i promised myself what rules do i have for myself what vows am i carrying what childhood promises am i still living by what unexamined commitments am i carrying what self-authored constraints what are my operating principles", run: (r) => r.push("/vows") },
  { id: "nav-imagined-futures", label: "Imagined-future register", section: "Navigate", keywords: "imagined future register imagined-future register imagined futures futures i'm imagining future selves visiting futures mentally future visit visiting futures the future i picture the life i picture the version of me who i keep thinking about i keep imagining i find myself wondering i picture myself i daydream about i fantasise about i fantasize about i've been fantasising about i've been fantasizing about i dream about i can see myself what if i just what if i moved what if i quit what if i started what if i wrote what if i left in another life parallel life the version of me who the me who lived the future me future-me older me when i'm older when i retire one day i will maybe one day i someday i it would be nice to it would be amazing to imagine if i imagine if we i picture a life where i picture myself in i picture us in i can picture i can imagine i could see myself i could imagine i could picture pull kind seeking escaping grieving entertaining genuine pull a real pull pulling me real attraction asking to be made real pressure release valve pressure-release valve escape valve escapism escape work escape fantasy mental escape doing the imagining the imagining is the work daydream as relief grieving a closed path mourning a closed future mourning a path that has already closed the path that closed the version of me who chose differently the road not taken what i won't get to live what i'll never have entertaining curiosity idle wondering passing thought wondering without weight no weight no charge fleeting recurring persistent vivid searing the future feels almost more real than current life caught myself living in it pursue this future make it real first concrete step take the step convert to action plan it now release let it go release me from it release the future let go of the future release valve released sit with sitting with sitting-with not yet hold it as a possibility hold the door open without forcing without deciding refuse the binary refuse make-it-a-goal-or-stop-daydreaming refuse the false choice grieve the future mourn the future lost future closed future i'm not going back honour the loss dismiss false alarm work health relationships family finance creative self spiritual scan imagined futures mine my chats for imagined futures surface what i've been imagining what futures i've been visiting what i'm dreaming about what is calling me what's pulling me where am i escaping into where am i grieving where do i keep going in my head", run: (r) => r.push("/imagined-futures") },
  { id: "nav-almosts", label: "Almost-register", section: "Navigate", keywords: "almost register almost-register near miss near-miss near misses near-misses i almost i nearly i was about to i came close to i started typing but deleted i drafted but didn't send i picked up the phone and put it down stopped myself talked myself out of chickened out backed out cold feet pulled back at the last second i was going to but i had my hand on i had my finger on i nearly said i nearly sent i nearly replied i nearly bought i nearly quit i almost quit i almost replied i almost reached out i almost messaged i almost called i almost asked her out i almost told him i almost confessed i almost left the meeting i almost walked out i almost said no i almost said yes i was about to send i was about to reply i was about to quit i was about to walk out i nearly cancelled i nearly bought it the brake came on what stopped me what pulled me back relief regret mixed regret tilt regret-tilt was the brake wisdom was the brake fear thank god i didn't i wish i had i let myself down again i'm a coward chickened out reaching out saying no leaving staying starting quitting spending refusing confronting asking confessing weight finger on trigger last second reversal honour the brake mourn what i almost did try again now retry convert into a present commitment what i'm committing to now bridge from near miss to action self betrayal wisdom the line i stopped at the line i didn't cross what i nearly did but didn't a register of near misses retry an almost", run: (r) => r.push("/almosts") },
  { id: "nav-thresholds", label: "Threshold ledger", section: "Navigate", keywords: "threshold ledger thresholds threshold crossing threshold crossings i never thought i would i never thought i'd i'd never have first time i actually first time ever first time in years first time i can remember the first time i used to think i couldn't i used to think i wouldn't i used to be too scared to i used to be the kind of person who couldn't i would never have i wouldn't have before i was wouldn't have before now i'm someone who i'm someone who can i've become someone who i've turned into someone who since when did i since when did i become when did i become i don't recognise this person i don't recognise myself i'm not the person i was who am i becoming who i'm becoming who i no longer am the old me would have the old me wouldn't have the old me i used to old me old version of me past me past self threshold crossed crossed a threshold crossed a line i crossed a line in a good way crossed a line in a bad way before state and after state before and after pivot kind capability belief boundary habit identity aesthetic relational material magnitude charge growth drift mixed positive crossing worrying crossing relief pride alarm shame integrate as identity evidence dispute the framing dismiss false alarm anti gaslighting evidence of becoming who you are becoming evidence of growth evidence of change a register of who you are becoming personal change log identity change log personal evolution log my growth my drift my crossings i held a boundary i said no for the first time i shipped i finished i finally i actually did it i did the thing i was scared of integrate dispute dismiss pinned archived scan for thresholds scan thresholds mine my chats for thresholds surface threshold crossings", run: (r) => r.push("/thresholds") },
  { id: "nav-ventures", label: "Ventures", section: "Navigate", keywords: "ventures businesses portfolio ceo mode operator loop heartbeats decisions queue auto-execute notify approve thesis budget kill criteria autopilot board chair the board run the floor pe portfolio jarvis runs the businesses delegate to jarvis micro saas micro businesses experiments autonomous business autonomous venture chief of staff coo founder mode chairman mode silent operator daily operator loop signals metrics burn rate runway operator memory living strategy doc decision matrix decision rights matrix tier ladder ceo console venture board venture log", run: (r) => r.push("/ventures") },
  { id: "nav-hist", label: "History", section: "Navigate", shortcut: "Y", keywords: "conversations past", run: (r) => r.push("/history") },
  { id: "nav-err", label: "Errors", section: "Navigate", shortcut: "X", keywords: "logs sentry", run: (r) => r.push("/errors") },
  { id: "nav-anl", label: "Analytics", section: "Navigate", shortcut: "N", keywords: "stats posthog", run: (r) => r.push("/analytics") },
  { id: "nav-ins", label: "Insights", section: "Navigate", shortcut: "Z", keywords: "weekly trends week over week", run: (r) => r.push("/insights") },
  { id: "nav-cost", label: "Costs", section: "Navigate", shortcut: "L", keywords: "llm spend tokens", run: (r) => r.push("/costs") },
  { id: "nav-auto-page", label: "Automations", section: "Navigate", shortcut: "A", keywords: "rules triggers", run: (r) => r.push("/automations") },
  { id: "nav-skl", label: "Skills", section: "Navigate", shortcut: "K", keywords: "plugins capabilities", run: (r) => r.push("/skills") },
  { id: "nav-int", label: "Integrations", section: "Navigate", shortcut: "G", keywords: "providers connected", run: (r) => r.push("/integrations") },
  { id: "nav-set", label: "Settings", section: "Navigate", shortcut: ",", run: (r) => r.push("/settings") },
  { id: "nav-brief", label: "Today's briefing", section: "JARVIS", run: (r) => r.push("/morning-briefing") },
  { id: "nav-wrap", label: "Evening wrap", section: "JARVIS", keywords: "recap day", run: (r) => r.push("/evening-wrap") },
  { id: "nav-wkly", label: "Weekly review", section: "JARVIS", keywords: "sunday week", run: (r) => r.push("/weekly-review") },
  { id: "nav-chat", label: "Full chat view", section: "JARVIS", run: (r) => r.push("/chat") },
  { id: "nav-auto", label: "Autopilot console", section: "JARVIS", run: (r) => r.push("/autopilot") },
  { id: "nav-avatar", label: "Avatar", section: "JARVIS", keywords: "hologram face", run: (r) => r.push("/avatar") },
  { id: "act-draft", label: "Draft an email…", section: "Action", keywords: "mail gmail write", run: (r) => r.push("/chat?q=" + encodeURIComponent("Draft an email to ")) },
  { id: "act-meeting", label: "Schedule a meeting…", section: "Action", keywords: "calendar", run: (r) => r.push("/chat?q=" + encodeURIComponent("Schedule a meeting ")) },
  { id: "act-remind", label: "Remind me…", section: "Action", keywords: "task todo", run: (r) => r.push("/chat?q=" + encodeURIComponent("Remind me ")) },
  { id: "act-research", label: "Research a topic…", section: "Action", keywords: "dig investigate deep", run: (r) => r.push("/chat?q=" + encodeURIComponent("Research ")) },
  { id: "act-errand", label: "Start an errand…", section: "Action", keywords: "do task browser agent", run: (r) => r.push("/chat?q=" + encodeURIComponent("Please ")) },
  { id: "act-cancel-sub", label: "Cancel a subscription…", section: "Action", keywords: "unsubscribe stop", run: (r) => r.push("/chat?q=" + encodeURIComponent("Cancel my subscription to ")) },
  { id: "act-onboard", label: "Restart onboarding", section: "Action", run: (r) => r.push("/onboarding") },
  {
    id: "act-mode-ceo",
    label: "Switch to CEO mode",
    section: "Action",
    keywords: "mode ceo ventures portfolio operator chair the board run the floor founder mode autonomous business swap mode",
    run: () => void fireAction("Mode", "/api/mode", "Now in CEO mode", { mode: "ceo" }),
  },
  {
    id: "act-mode-assistant",
    label: "Switch to Assistant mode",
    section: "Action",
    keywords: "mode assistant default standard pa personal assistant swap mode",
    run: () => void fireAction("Mode", "/api/mode", "Now in Assistant mode", { mode: "assistant" }),
  },
  {
    id: "act-panic-stop-ventures",
    label: "PANIC STOP — halt all venture autonomy",
    section: "Action",
    keywords: "stop emergency kill switch ventures ceo halt freeze pause everything autonomy off",
    run: () => void fireAction("Ventures", "/api/ventures/panic-stop", "Panic stop ON — autonomy halted"),
  },
  {
    id: "act-clear-panic-stop",
    label: "Resume venture autonomy (clear panic stop)",
    section: "Action",
    keywords: "resume autonomy ventures unstop unfreeze go again clear panic",
    run: () => void fireAction("Ventures", "/api/ventures/panic-clear", "Autonomy resumed"),
  },
  {
    id: "act-run-briefing",
    label: "Run morning briefing now",
    section: "Action",
    keywords: "briefing daily trigger",
    run: () => void fireAction("Briefing", "/api/briefing/run", "Briefing started"),
  },
  {
    id: "act-run-wrap",
    label: "Run evening wrap now",
    section: "Action",
    keywords: "wrap recap day trigger",
    run: () => void fireAction("Evening wrap", "/api/evening-wrap/run", "Evening wrap started"),
  },
  {
    id: "act-run-weekly",
    label: "Run weekly review now",
    section: "Action",
    keywords: "weekly review sunday trigger",
    run: () => void fireAction("Weekly review", "/api/weekly-review/run", "Weekly review started"),
  },
  {
    id: "act-scan-receipts",
    label: "Scan email for receipts",
    section: "Action",
    keywords: "receipts sweep email 60d",
    run: () => void fireAction("Receipts scan", "/api/receipts/scan", "Scanning last 60d"),
  },
  {
    id: "act-categorize-receipts",
    label: "Auto-categorize receipts",
    section: "Action",
    keywords: "receipts category tag",
    run: () => void fireAction("Auto-categorize", "/api/receipts/auto-categorize", "Categorizing…"),
  },
  {
    id: "act-scan-subs",
    label: "Scan for subscriptions",
    section: "Action",
    keywords: "subscriptions recurring bank email",
    run: () => void fireAction("Subscriptions scan", "/api/subscriptions/scan", "Scanning for subscriptions"),
  },
  {
    id: "act-scan-commits",
    label: "Scan for commitments",
    section: "Action",
    keywords: "promises commitments deadlines",
    run: () => void fireAction("Commitments scan", "/api/commitments/scan", "Looking for commitments"),
  },
  {
    id: "act-capture",
    label: "Capture a thought…",
    section: "Action",
    keywords: "memory note save fact quick capture",
    run: () => {
      const fn = (window as unknown as { __jarvisQuickCapture?: () => void }).__jarvisQuickCapture;
      fn?.();
    },
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.section.toLowerCase().includes(q) ||
        (c.keywords ?? "").toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const m: Record<string, Command[]> = {};
    results.forEach((c) => {
      (m[c.section] ??= []).push(c);
    });
    return m;
  }, [results]);

  const flat = results;

  const run = (c: Command) => {
    setOpen(false);
    c.run?.(router);
  };

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(580px, calc(100% - 48px))",
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 16,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
          overflow: "hidden",
          fontFamily: "var(--sans)",
          color: "var(--ink)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 20,
              color: "var(--ink-3)",
            }}
          >
            /
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const c = flat[active];
                if (c) run(c);
              }
            }}
            placeholder="Where to, what to do…"
            style={{
              flex: 1,
              fontFamily: "var(--sans)",
              fontSize: 15,
              color: "var(--ink)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--bg)",
              color: "var(--ink-3)",
              border: "1px solid var(--rule)",
              letterSpacing: "0.4px",
            }}
          >
            ESC
          </span>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "8px 0" }}>
          {Object.entries(grouped).map(([section, commands]) => (
            <div key={section} style={{ padding: "4px 0 10px" }}>
              <div
                style={{
                  padding: "8px 20px 4px",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  letterSpacing: "1.4px",
                  textTransform: "uppercase",
                }}
              >
                {section}
              </div>
              {commands.map((c) => {
                const idx = flat.indexOf(c);
                const isActive = idx === active;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => run(c)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 20px",
                      background: isActive ? "var(--surface-2)" : "transparent",
                      border: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "var(--sans)",
                      fontSize: 14,
                      color: "var(--ink)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: isActive ? "var(--indigo)" : "var(--ink-4)",
                      }}
                    />
                    <span style={{ flex: 1 }}>{c.label}</span>
                    {c.shortcut && (
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--bg)",
                          color: "var(--ink-3)",
                          border: "1px solid var(--rule)",
                          letterSpacing: "0.4px",
                        }}
                      >
                        {c.shortcut}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {flat.length === 0 && (
            <div
              style={{
                padding: "32px 24px",
                textAlign: "center",
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 18,
                color: "var(--ink-3)",
              }}
            >
              Nothing matches. Try another phrasing.
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid var(--rule)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "var(--bg)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            ↑↓ MOVE · ↩ RUN · ⌘K CLOSE
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            I&rsquo;m here.
          </div>
        </div>
      </div>
    </div>
  );
}
