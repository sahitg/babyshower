/* ------------------------------------------------------------------
   Baby shower site — defaults.
   Anything you set in the Google Sheet's "Settings" tab (or from the
   host dashboard) overrides the values here at page load, so you rarely
   need to edit this file after the first deploy.
   ------------------------------------------------------------------ */
window.SHOWER_CONFIG = {
  // Paste the Apps Script "Web app" URL here after deploying it (see DEPLOY.md).
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbzikVYb2LfGScYTr6LqSH3eCuOUzNo2Q3I3jnLmMXVbKCBZQ0XEBzxTyEFCUFnKXoLR6A/exec",
  // The public address of this site once it is live (used in emails and share links).
  siteUrl: "https://sahitg.github.io/baby-shower/",

  parents: ["Rachana", "Sahit"],
  familyName: "Garapati",
  eventTitle: "A baby shower for Rachana & Sahit",
  hostedBy: "Hosted by Sahit",

  date: "2026-10-31",          // YYYY-MM-DD
  startTime: "11:00",          // 24h, local to timeZone
  endTime: "16:00",
  timeZone: "America/Los_Angeles",
  rsvpBy: "2026-10-27",

  // Guessing game
  dueMonth: "2027-01",         // YYYY-MM; guesses are allowed 6 weeks either side
  showSex: false,              // true = you've shared the sex; the game stops asking "boy or girl?"
  babySex: "boy",              // "boy" | "girl" | "" (only used when showSex is true)

  venueName: "The Club at Snoqualmie Ridge",
  venueAddress: "36005 SE Ridge St, Snoqualmie, WA 98065",
  mapsUrl: "",

  registry: [
    { label: "Our Babylist registry", url: "https://my.babylist.com/rachana-mandru" }
  ],

  contactName: "Sahit",
  contactEmail: "g.sahit.iitr@gmail.com",
  contactPhone: "(314) 814-3486",

  parking: "Free parking in the club's lot. Carpooling is welcome but not required.",
  dressCode: "Autumn casual. We'll be indoors, but bring a layer for photos outside.",
  kidsNote: "Kids are very welcome. Let us know how many are coming so we can plan activities and seating.",
  giftNote: "Your presence is the real gift. If you'd like to bring something, the registry has everything we've been dreaming about. Items can ship straight to our home or come along with you.",

  schedule: [
    ["11:00", "Welcome drinks & snacks"],
    ["12:00", "Lunch"],
    ["1:00",  "Games & the guessing board"],
    ["2:30",  "Cake, wishes & a few words"],
    ["4:00",  "Farewell"]
  ],

  photoUrl: "",

  // Message templates for text / WhatsApp. {first} and {link} are filled in per guest.
  smsTemplate: "Hi {first}! Rachana and I are hosting a baby shower on Sat, Oct 31 (11am–4pm) near Snoqualmie and would love for you to come. All the details + RSVP are here: {link}",
  reminderTemplate: "Hi {first}, just a nudge: we're still hoping you can join us for the baby shower on Sat, Oct 31. Could you RSVP by Oct 24? {link}",
  dayBeforeTemplate: "Hi {first}! See you tomorrow at the baby shower, 11am–4pm. Address and parking details are here: {link}"
};
