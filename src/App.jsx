import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const services = [
  {
    name: 'Bath & Brush',
    price: 45,
    time: '60 min',
    color: 'var(--sky)',
    blurb: 'Warm oatmeal bath, blow-dry, full brush-out and a spritz of something nice.',
  },
  {
    name: 'Full Groom',
    price: 75,
    time: '2 hrs',
    color: 'var(--coral)',
    blurb: 'Everything in Bath & Brush, plus a breed-style haircut, nail trim and ear clean.',
    popular: true,
  },
  {
    name: 'Pawdicure',
    price: 20,
    time: '20 min',
    color: 'var(--mint)',
    blurb: 'Nail trim and file, paw pad balm, and a little wiggle room between the toes.',
  },
  {
    name: 'Kitty Spa',
    price: 60,
    time: '75 min',
    color: 'var(--lilac)',
    blurb: 'Quiet-room grooming for cats: gentle bath or waterless clean, de-shed and nails.',
  },
]

const steps = [
  { title: 'Pick a time', text: 'Choose a service and a slot that suits you. Takes under a minute.' },
  { title: 'Drop off (with a treat)', text: 'We meet your pet, learn their quirks and get them settled.' },
  { title: 'Pick up a fluffball', text: 'We text you when they are fresh, fluffy and ready for their close-up.' },
]

const reviews = [
  { quote: 'Biscuit hates baths. He came out wagging. I do not know what sorcery this is.', name: 'Priya, Biscuit’s human' },
  { quote: 'They sent me photos halfway through so I wouldn’t worry. Mochi looks like a cloud.', name: 'Dan, Mochi’s human' },
  { quote: 'The only groomer our anxious rescue will walk into on her own. That says it all.', name: 'Lena, Pepper’s human' },
]

function Paw({ size = 24, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style} aria-hidden="true">
      <ellipse cx="6" cy="9" rx="2.2" ry="2.8" />
      <ellipse cx="10" cy="5.5" rx="2.2" ry="2.8" />
      <ellipse cx="14.5" cy="5.5" rx="2.2" ry="2.8" />
      <ellipse cx="18.5" cy="9" rx="2.2" ry="2.8" />
      <path d="M12.2 11c3 0 6 3.6 6 6.4 0 2-1.6 2.9-3.2 2.6-1.1-.2-1.8-.8-2.8-.8s-1.7.6-2.8.8C7.8 20.3 6.2 19.4 6.2 17.4 6.2 14.6 9.2 11 12.2 11z" />
    </svg>
  )
}

function Dog() {
  return (
    <svg viewBox="0 0 240 240" className="dog" role="img" aria-label="A happy, freshly groomed dog">
      <motion.g
        style={{ originX: 0.8, originY: 0 }}
        animate={{ rotate: [0, -8, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d="M70 60 C30 55 20 120 45 150 C60 165 80 140 80 110 Z" fill="#8a5a3c" />
      </motion.g>
      <motion.g
        style={{ originX: 0.2, originY: 0 }}
        animate={{ rotate: [0, 8, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      >
        <path d="M170 60 C210 55 220 120 195 150 C180 165 160 140 160 110 Z" fill="#8a5a3c" />
      </motion.g>
      <circle cx="120" cy="120" r="72" fill="#f2c28b" />
      <ellipse cx="120" cy="150" rx="42" ry="32" fill="#fbe3c4" />
      <motion.g
        animate={{ scaleY: [1, 1, 0.1, 1] }}
        transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.95, 1] }}
        style={{ originY: 0.5 }}
      >
        <circle cx="94" cy="108" r="8" fill="#2b2118" />
        <circle cx="146" cy="108" r="8" fill="#2b2118" />
        <circle cx="97" cy="105" r="2.5" fill="#fff" />
        <circle cx="149" cy="105" r="2.5" fill="#fff" />
      </motion.g>
      <ellipse cx="120" cy="136" rx="12" ry="8.5" fill="#2b2118" />
      <path d="M108 150 Q120 160 132 150" stroke="#2b2118" strokeWidth="4" fill="none" strokeLinecap="round" />
      <motion.path
        d="M113 154 Q120 180 127 154 Z"
        fill="#ff7a8a"
        animate={{ scaleY: [1, 1.15, 1] }}
        transition={{ duration: 0.8, repeat: Infinity }}
        style={{ originY: 0 }}
      />
      <circle cx="80" cy="140" r="9" fill="#ffb3a7" opacity="0.6" />
      <circle cx="160" cy="140" r="9" fill="#ffb3a7" opacity="0.6" />
      <path d="M92 58 q10 -22 28 -6 q18 -16 28 6" fill="#fff" stroke="#e8d7ff" strokeWidth="3" />
      <circle cx="120" cy="50" r="7" fill="var(--coral)" />
    </svg>
  )
}

function Bubbles() {
  const bubbles = [
    { left: '8%', size: 26, delay: 0 },
    { left: '22%', size: 14, delay: 1.2 },
    { left: '70%', size: 20, delay: 0.6 },
    { left: '84%', size: 32, delay: 2 },
    { left: '55%', size: 12, delay: 2.8 },
  ]
  return (
    <div className="bubbles" aria-hidden="true">
      {bubbles.map((b, i) => (
        <motion.span
          key={i}
          className="bubble"
          style={{ left: b.left, width: b.size, height: b.size }}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: -320, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 6, repeat: Infinity, delay: b.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 120, damping: 16 } },
}

function Section({ id, className = '', children }) {
  return (
    <motion.section
      id={id}
      className={`section ${className}`}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      transition={{ staggerChildren: 0.1 }}
    >
      {children}
    </motion.section>
  )
}

function BookingForm({ preselected }) {
  const [sent, setSent] = useState(null)
  const today = new Date().toISOString().slice(0, 10)

  function handleSubmit(e) {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(e.currentTarget))
    setSent(data)
  }

  return (
    <div className="booking-card">
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="done"
            className="booking-done"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div animate={{ rotate: [0, -15, 15, 0] }} transition={{ duration: 0.8 }}>
              <Paw size={56} color="var(--coral)" />
            </motion.div>
            <h3>Woohoo! {sent.pet || 'Your pet'} is on the list.</h3>
            <p>
              We’ll text you to confirm your {sent.service} on {sent.date}. Treats are already being counted.
            </p>
            <button className="btn btn-ghost" onClick={() => setSent(null)}>
              Book another pet
            </button>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={handleSubmit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="field-row">
              <label>
                Your name
                <input name="owner" required placeholder="Alex" autoComplete="name" />
              </label>
              <label>
                Pet’s name
                <input name="pet" required placeholder="Sir Fluffington" />
              </label>
            </div>
            <div className="field-row">
              <label>
                Phone
                <input name="phone" type="tel" required placeholder="(555) 123-4567" autoComplete="tel" />
              </label>
              <label>
                Service
                <select name="service" key={preselected} defaultValue={preselected}>
                  {services.map((s) => (
                    <option key={s.name}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Preferred date
              <input name="date" type="date" required min={today} />
            </label>
            <motion.button type="submit" className="btn btn-primary btn-block" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              Request my appointment
            </motion.button>
            <p className="fine">No payment now. We confirm every booking by text within 2 hours.</p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  const [service, setService] = useState('Full Groom')

  function bookService(name) {
    setService(name)
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      <header className="nav">
        <a href="#top" className="logo">
          <Paw size={28} color="var(--coral)" /> Wag &amp; Whiskers
        </a>
        <nav>
          <a href="#services">Services</a>
          <a href="#how">How it works</a>
          <a href="#reviews">Reviews</a>
        </nav>
        <a href="#book" className="btn btn-primary btn-sm">Book now</a>
      </header>

      <main id="top">
        <section className="hero">
          <Bubbles />
          <motion.div className="hero-copy" initial="hidden" animate="show" transition={{ staggerChildren: 0.12 }}>
            <motion.span variants={fadeUp} className="pill">Now booking this week</motion.span>
            <motion.h1 variants={fadeUp}>
              Bath time,<br />
              but make it <span className="squiggle">fun</span>.
            </motion.h1>
            <motion.p variants={fadeUp} className="lead">
              Gentle, stress-free grooming for dogs and cats. Our pets leave fluffier, happier and just a
              little bit smug.
            </motion.p>
            <motion.div variants={fadeUp} className="hero-ctas">
              <motion.a href="#book" className="btn btn-primary btn-lg" whileHover={{ scale: 1.05, rotate: -1 }} whileTap={{ scale: 0.96 }}>
                Book a groom
              </motion.a>
              <a href="#services" className="btn btn-ghost btn-lg">See prices</a>
            </motion.div>
            <motion.ul variants={fadeUp} className="trust">
              <li><strong>4.9★</strong> from 1,200+ reviews</li>
              <li><strong>Certified</strong> fear-free groomers</li>
            </motion.ul>
          </motion.div>
          <motion.div
            className="hero-art"
            initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 90, damping: 12, delay: 0.2 }}
          >
            <div className="blob" />
            <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
              <Dog />
            </motion.div>
            <motion.div className="sticker" animate={{ rotate: [-6, 6, -6] }} transition={{ duration: 4, repeat: Infinity }}>
              100% <br />good boy
            </motion.div>
          </motion.div>
        </section>

        <Section id="services">
          <motion.h2 variants={fadeUp}>Pick your pamper</motion.h2>
          <motion.p variants={fadeUp} className="section-lead">Every visit includes a bandana, a treat and a lot of praise.</motion.p>
          <div className="services">
            {services.map((s) => (
              <motion.article
                key={s.name}
                variants={fadeUp}
                className="service"
                style={{ '--accent': s.color }}
                whileHover={{ y: -8, rotate: -1 }}
              >
                {s.popular && <span className="badge">Most loved</span>}
                <div className="service-icon"><Paw size={30} color="#fff" /></div>
                <h3>{s.name}</h3>
                <p>{s.blurb}</p>
                <div className="service-meta">
                  <span className="price">from ${s.price}</span>
                  <span className="time">{s.time}</span>
                </div>
                <button className="btn btn-outline" onClick={() => bookService(s.name)}>
                  Book {s.name}
                </button>
              </motion.article>
            ))}
          </div>
        </Section>

        <Section id="how" className="how">
          <motion.h2 variants={fadeUp}>Easy as sit, stay, groom</motion.h2>
          <ol className="steps">
            {steps.map((st, i) => (
              <motion.li key={st.title} variants={fadeUp}>
                <span className="step-num">{i + 1}</span>
                <h3>{st.title}</h3>
                <p>{st.text}</p>
              </motion.li>
            ))}
          </ol>
        </Section>

        <Section id="reviews">
          <motion.h2 variants={fadeUp}>Tails are wagging</motion.h2>
          <div className="reviews">
            {reviews.map((r, i) => (
              <motion.figure key={r.name} variants={fadeUp} className="review" style={{ rotate: i % 2 ? 1.5 : -1.5 }}>
                <blockquote>“{r.quote}”</blockquote>
                <figcaption>{r.name}</figcaption>
              </motion.figure>
            ))}
          </div>
        </Section>

        <Section id="book" className="book">
          <div className="book-copy">
            <motion.h2 variants={fadeUp}>Ready for a fluff-over?</motion.h2>
            <motion.p variants={fadeUp}>
              Tell us who’s coming and when. We’ll confirm by text and save your pet a spot on the comfy mat.
            </motion.p>
            <motion.ul variants={fadeUp} className="perks">
              <li><Paw size={18} color="var(--coral)" /> First visit? 15% off any service</li>
              <li><Paw size={18} color="var(--coral)" /> Free rescheduling up to 24 hrs before</li>
              <li><Paw size={18} color="var(--coral)" /> Open Tue–Sun, 8am–6pm</li>
            </motion.ul>
          </div>
          <motion.div variants={fadeUp}>
            <BookingForm preselected={service} />
          </motion.div>
        </Section>
      </main>

      <footer className="footer">
        <span className="logo"><Paw size={22} color="var(--coral)" /> Wag &amp; Whiskers</span>
        <span>123 Bark Street · hello@wagandwhiskers.example · (555) 123-4567</span>
        <span>© {new Date().getFullYear()} Wag &amp; Whiskers Grooming</span>
      </footer>
    </>
  )
}
