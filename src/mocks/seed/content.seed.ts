/** Training content for the seed: the 7 topics from the FRD and their questionnaires. */

export interface TopicSeed {
  name: string;
  description: string;
  icon: string;
}

export interface QuestionSeed {
  text: string;
  options: string[];
  /** Index of the correct option. */
  correct: number;
  explanation: string | null;
}

export interface QuestionnaireSeed {
  topic: string;
  title: string;
  description: string;
  passingScore: number;
  timeLimitMinutes: number | null;
  status: 'active' | 'inactive';
  questions: QuestionSeed[];
  /** When set, version 1 had only `questions` and version 2 added these. */
  addedInVersion2?: QuestionSeed[];
}

export const topicSeeds: TopicSeed[] = [
  {
    name: 'Phishing Awareness',
    description:
      'Recognize fraudulent emails, messages and calls that try to steal credentials or money.',
    icon: 'fish',
  },
  {
    name: 'Password Security',
    description:
      'Create strong passwords, use a password manager and protect accounts with multi-factor authentication.',
    icon: 'key-round',
  },
  {
    name: 'Data Protection',
    description: 'Handle personal and confidential data correctly, from collection to deletion.',
    icon: 'shield-check',
  },
  {
    name: 'Social Engineering',
    description: 'Spot manipulation techniques such as pretexting, baiting and tailgating.',
    icon: 'users',
  },
  {
    name: 'Safe Internet Usage',
    description:
      'Browse, download and use public networks without exposing yourself or the company.',
    icon: 'globe',
  },
  {
    name: 'Device Security',
    description: 'Keep laptops, phones and removable media updated, locked and encrypted.',
    icon: 'laptop',
  },
  {
    name: 'Remote Work Security',
    description: 'Work safely from home, while traveling and on shared networks.',
    icon: 'house',
  },
];

export const questionnaireSeeds: QuestionnaireSeed[] = [
  {
    topic: 'Phishing Awareness',
    title: 'Spotting phishing emails',
    description: 'Learn the warning signs of a phishing email and what to do when you receive one.',
    passingScore: 80,
    timeLimitMinutes: null,
    status: 'active',
    questions: [
      {
        text: 'An email from "IT Support" asks you to confirm your password through a link. What should you do?',
        options: [
          'Click the link and confirm your password',
          'Reply with your password so IT can verify it',
          'Report the email as phishing without clicking the link',
          'Forward it to your colleagues to warn them',
        ],
        correct: 2,
        explanation:
          'IT will never ask for your password. Report suspicious emails with the report button.',
      },
      {
        text: 'Which sender address is the strongest sign of phishing?',
        options: [
          'support@brightwater.example',
          'support@brightwater-example.help',
          'noreply@brightwater.example',
          'hr@brightwater.example',
        ],
        correct: 1,
        explanation:
          'Attackers register look-alike domains. Check the domain after the @ carefully.',
      },
      {
        text: 'How can you safely check where a link leads before opening it?',
        options: [
          'Hover over the link and read the address that appears',
          'Click it quickly and close the tab',
          'Trust it if the email has the company logo',
          'Copy it into a chat with a colleague',
        ],
        correct: 0,
        explanation: 'Hovering shows the real destination. Logos and formatting are easy to copy.',
      },
      {
        text: 'An urgent email from your CEO asks you to buy gift cards today. What is the best response?',
        options: [
          'Buy the gift cards, since it is urgent',
          'Verify the request with the CEO through a known phone number or chat',
          'Reply to the email to ask for more details',
          'Ignore it and delete it without telling anyone',
        ],
        correct: 1,
        explanation:
          'Urgency and unusual payment requests are classic signs. Verify through a channel you already trust.',
      },
    ],
    addedInVersion2: [
      {
        text: 'A poster in the office has a QR code that promises a free lunch voucher after you sign in. What is the risk?',
        options: [
          'None, QR codes cannot contain links',
          'The QR code may lead to a fake sign-in page that steals your credentials',
          'It may drain your phone battery',
          'It only works on company phones',
        ],
        correct: 1,
        explanation: 'QR codes hide the link they open. Treat them like any other link.',
      },
    ],
  },
  {
    topic: 'Phishing Awareness',
    title: 'Phishing beyond email',
    description:
      'Phishing also arrives by text message, phone call and chat. Learn how to recognize it.',
    passingScore: 80,
    timeLimitMinutes: 10,
    status: 'active',
    questions: [
      {
        text: 'You get a text message saying a parcel is held until you pay a small fee through a link. What is this most likely?',
        options: [
          'A normal delivery notice',
          'Smishing (SMS phishing)',
          'A spam filter test',
          'A message from your bank',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'A caller says they are from the bank and asks for a code you just received by text. What should you do?',
        options: [
          'Read out the code',
          'Hang up and call the bank on the number on your card',
          'Ask them to send an email instead',
          'Give only half of the code',
        ],
        correct: 1,
        explanation: 'One-time codes are for you only. Banks never ask for them by phone.',
      },
      {
        text: 'A colleague messages you in chat from a new account, asking for a client list. What do you do first?',
        options: [
          'Send the list',
          'Confirm with the colleague through their known account or by phone',
          'Post the list in a public channel',
          'Ask your manager to send it',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Which of these is a sign of a vishing (voice phishing) call?',
        options: [
          'The caller pressures you to act immediately',
          'The caller gives you time to call back',
          'The caller is someone you called',
          'The call is from a known colleague about a meeting',
        ],
        correct: 0,
        explanation:
          'Pressure and urgency are used to stop you from thinking. Slow down and verify.',
      },
      {
        text: 'Where should you report a suspicious text or call related to work?',
        options: [
          'Nowhere, it is not email',
          'To the IT and security team',
          'Only to your family',
          'On social media',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Password Security',
    title: 'Strong passwords and password managers',
    description: 'Build passwords that are hard to guess and let a password manager remember them.',
    passingScore: 80,
    timeLimitMinutes: null,
    status: 'active',
    questions: [
      {
        text: 'Which password is the strongest?',
        options: ['Summer2026!', 'P@ssw0rd', 'correct-horse-battery-staple-lake', 'Brightwater1'],
        correct: 2,
        explanation: 'Long passphrases of random words are both strong and easy to type.',
      },
      {
        text: 'Why should you use a different password for every account?',
        options: [
          'It is required by law',
          'If one site leaks your password, attackers cannot use it on your other accounts',
          'It makes passwords shorter',
          'It is easier to remember',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'What is the safest place to keep your passwords?',
        options: [
          'A note on your monitor',
          'A spreadsheet on your desktop',
          'The company-approved password manager',
          'Your email drafts',
        ],
        correct: 2,
        explanation:
          'A password manager encrypts your passwords and fills them in only on the right sites.',
      },
      {
        text: 'A website tells you your password was found in a data breach. What should you do?',
        options: [
          'Nothing',
          'Change it on that site and anywhere else you used it',
          'Add a number at the end',
          'Wait for IT to contact you',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'A colleague asks to borrow your password to finish urgent work while you are away. What should you do?',
        options: [
          'Share it by chat',
          'Share it by phone',
          'Refuse and suggest they ask IT for their own access',
          'Write it down for them',
        ],
        correct: 2,
        explanation:
          'Passwords are personal. Shared access makes it impossible to know who did what.',
      },
    ],
  },
  {
    topic: 'Password Security',
    title: 'Multi-factor authentication',
    description: 'Understand why a second factor matters and how to use it safely.',
    passingScore: 70,
    timeLimitMinutes: null,
    status: 'active',
    questions: [
      {
        text: 'What does multi-factor authentication add to a password?',
        options: [
          'A second, longer password',
          'Something you have or are, such as a phone app or fingerprint',
          'A security question',
          'Nothing, it replaces the password',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'You get an unexpected sign-in approval request on your phone. What should you do?',
        options: [
          'Approve it to make it stop',
          'Deny it and change your password',
          'Approve it and check later',
          'Ignore it',
        ],
        correct: 1,
        explanation: 'An unexpected request means someone may have your password.',
      },
      {
        text: 'Which second factor is the most resistant to phishing?',
        options: [
          'Codes sent by text message',
          'A hardware security key',
          'Security questions',
          'Codes sent by email',
        ],
        correct: 1,
        explanation: 'Security keys check the website address, so they do not work on fake sites.',
      },
      {
        text: 'Where should you keep your backup recovery codes?',
        options: [
          'In a public folder',
          'In your password manager or another secure place',
          'In an email to yourself',
          'On a sticky note on your laptop',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Data Protection',
    title: 'Handling personal data',
    description:
      'Learn how to collect, store, share and delete personal data in line with company policy.',
    passingScore: 90,
    timeLimitMinutes: 15,
    status: 'active',
    questions: [
      {
        text: 'Which of these is personal data?',
        options: [
          'The company address',
          'A customer’s email address',
          'The office opening hours',
          'A public product price',
        ],
        correct: 1,
        explanation: 'Any information that identifies a person is personal data.',
      },
      {
        text: 'You need to send a spreadsheet with employee salaries to payroll. How should you send it?',
        options: [
          'By personal email',
          'Through the approved secure file sharing tool',
          'On a USB stick by post',
          'In a public chat channel',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'You emailed customer data to the wrong person. What should you do?',
        options: [
          'Hope they do not open it',
          'Report it to the data protection contact right away',
          'Send another email asking them to ignore it',
          'Delete it from your sent folder',
        ],
        correct: 1,
        explanation:
          'Data breaches may need to be reported within strict deadlines. Report them at once.',
      },
      {
        text: 'How long should you keep personal data?',
        options: [
          'Forever, just in case',
          'Only as long as it is needed for its purpose',
          'Until your mailbox is full',
          'One week',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Where is it acceptable to store customer data?',
        options: [
          'On your personal cloud storage',
          'In approved company systems only',
          'On a shared drive open to everyone',
          'In your browser downloads folder',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Social Engineering',
    title: 'Recognizing manipulation',
    description: 'Attackers exploit trust, helpfulness and urgency. Learn to spot and stop them.',
    passingScore: 70,
    timeLimitMinutes: null,
    status: 'active',
    questions: [
      {
        text: 'Someone without a badge follows you through a secure door, saying they forgot theirs. What should you do?',
        options: [
          'Hold the door, it is polite',
          'Ask them to use reception to get a visitor badge',
          'Lend them your badge',
          'Ignore them',
        ],
        correct: 1,
        explanation: 'This is called tailgating. Reception can verify visitors.',
      },
      {
        text: 'You find a USB stick labeled "Salaries 2026" in the parking lot. What should you do?',
        options: [
          'Plug it in to find the owner',
          'Hand it to the IT and security team',
          'Take it home',
          'Throw it away',
        ],
        correct: 1,
        explanation:
          'Dropped USB sticks are a known baiting trick. They can install malware when plugged in.',
      },
      {
        text: 'A caller claims to be a new auditor and asks for details about our payment process. What is the right response?',
        options: [
          'Answer all questions',
          'Verify their identity and authorization before sharing anything',
          'Send them the process documents',
          'Give them a colleague’s number',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Which emotion do social engineers most often try to trigger?',
        options: ['Boredom', 'Urgency or fear', 'Calm', 'Indifference'],
        correct: 1,
        explanation: null,
      },
      {
        text: 'What is pretexting?',
        options: [
          'Writing a message in advance',
          'Inventing a believable story to get information',
          'Testing a password before use',
          'Encrypting text',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Safe Internet Usage',
    title: 'Browsing and downloads',
    description: 'Avoid malicious websites, fake downloads and risky public Wi-Fi.',
    passingScore: 80,
    timeLimitMinutes: null,
    status: 'active',
    questions: [
      {
        text: 'A website says your computer is infected and asks you to call a support number. What is this?',
        options: [
          'A real warning from your antivirus',
          'A tech support scam',
          'A browser update',
          'A message from IT',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Where should you download work software from?',
        options: [
          'Any site that offers it for free',
          'The company software portal or the vendor’s official site',
          'A file-sharing forum',
          'A link in a pop-up ad',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'What does the padlock icon in the address bar tell you?',
        options: [
          'The website is safe and trustworthy',
          'The connection to the site is encrypted, not that the site is honest',
          'The site is owned by a bank',
          'The site has no ads',
        ],
        correct: 1,
        explanation:
          'Phishing sites often have a padlock too. It only means the connection is encrypted.',
      },
      {
        text: 'How should you connect to work systems on public Wi-Fi?',
        options: [
          'Directly, public Wi-Fi is fine',
          'Through the company VPN',
          'Only with your phone’s browser',
          'You cannot connect at all',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'A browser extension asks to read and change all data on every website. What should you do?',
        options: [
          'Install it, all extensions ask this',
          'Only install extensions approved by IT',
          'Install it and remove it later',
          'Ask a friend',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Device Security',
    title: 'Securing your laptop and phone',
    description: 'Keep your devices locked, updated and encrypted, at the office and on the go.',
    passingScore: 80,
    timeLimitMinutes: 10,
    status: 'active',
    questions: [
      {
        text: 'What should you do when you leave your desk for a few minutes?',
        options: [
          'Nothing, it is only a few minutes',
          'Lock your screen',
          'Turn off the monitor',
          'Close your email',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Your laptop asks to install a security update. When should you install it?',
        options: [
          'As soon as possible',
          'Never, updates break things',
          'Only once a year',
          'Only when IT calls you',
        ],
        correct: 0,
        explanation: 'Updates fix vulnerabilities that attackers actively use.',
      },
      {
        text: 'Your work phone is lost. What should you do first?',
        options: [
          'Wait a few days to see if it turns up',
          'Report it to IT immediately so they can lock and wipe it',
          'Buy a new phone',
          'Post about it on social media',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Why is disk encryption important on a laptop?',
        options: [
          'It makes the laptop faster',
          'It protects the data if the laptop is lost or stolen',
          'It saves battery',
          'It is only needed for servers',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Is it acceptable to install personal apps from unknown sources on your work phone?',
        options: [
          'Yes, if they are free',
          'No, only install apps from approved stores and lists',
          'Yes, on weekends',
          'Only games',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Remote Work Security',
    title: 'Working securely from anywhere',
    description: 'Protect company data at home, in cafes, on trains and in hotels.',
    passingScore: 80,
    timeLimitMinutes: null,
    status: 'active',
    questions: [
      {
        text: 'You work on a train next to other passengers. What helps protect confidential information?',
        options: [
          'A privacy screen filter and care about what is visible',
          'Bigger font size',
          'Turning up the brightness',
          'Nothing',
        ],
        correct: 0,
        explanation: null,
      },
      {
        text: 'What should you change on your home Wi-Fi router?',
        options: [
          'Nothing',
          'The default admin password, and keep its firmware updated',
          'Only the network name',
          'The router color',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'Family members want to use your work laptop for homework. What should you do?',
        options: [
          'Let them, it is only homework',
          'Keep the work laptop for work use only',
          'Create a guest account for them',
          'Let them use it while you watch',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'You have to discuss a confidential topic on a video call in a cafe. What is the best option?',
        options: [
          'Talk quietly',
          'Move the call to a private space or reschedule',
          'Use the cafe’s Wi-Fi without VPN',
          'Turn off your camera',
        ],
        correct: 1,
        explanation: null,
      },
      {
        text: 'How should you dispose of printed work documents at home?',
        options: [
          'In the household recycling',
          'Shred them, or bring them to the office for secure disposal',
          'Keep them in a drawer forever',
          'Burn them in the garden',
        ],
        correct: 1,
        explanation: null,
      },
    ],
  },
  {
    topic: 'Password Security',
    title: 'Password basics (2025)',
    description:
      'The previous password training. Replaced by "Strong passwords and password managers".',
    passingScore: 80,
    timeLimitMinutes: null,
    status: 'inactive',
    questions: [
      {
        text: 'How often should you share your password with your manager?',
        options: ['Every month', 'Never', 'When asked', 'Once a year'],
        correct: 1,
        explanation: null,
      },
      {
        text: 'What makes a password stronger?',
        options: ['Length', 'Your birthday', 'Your pet’s name', 'The company name'],
        correct: 0,
        explanation: null,
      },
      {
        text: 'Should you reuse your work password on personal sites?',
        options: ['Yes', 'No'],
        correct: 1,
        explanation: null,
      },
    ],
  },
];
