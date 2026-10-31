-- Phase 4 ⚑4: the starting list of specialties and the symptom words that
-- suggest each one. Operations edit both in the console; Telugu and Hindi
-- wording is part of the pending translation review.
insert into public.specialties (code, names, keywords) values
  ('general_physician', '{"en":"General Physician","te":"జనరల్ ఫిజీషియన్","hi":"सामान्य चिकित्सक"}',
   '{"en":["fever","cold","cough","weakness","tired","body pain","vomiting","loose motion","headache"],"te":["జ్వరం","జలుబు","దగ్గు","నీరసం","ఒళ్ళు నొప్పులు","వాంతులు","విరేచనాలు","తలనొప్పి"],"hi":["बुखार","सर्दी","खांसी","कमज़ोरी","थकान","बदन दर्द","उल्टी","दस्त","सिरदर्द"]}'),
  ('cardiology', '{"en":"Cardiology","te":"కార్డియాలజీ","hi":"हृदय रोग"}',
   '{"en":["chest pain","palpitations","heart","bp","blood pressure","breathless"],"te":["ఛాతీ నొప్పి","గుండె దడ","గుండె","బీపీ","రక్తపోటు"],"hi":["सीने में दर्द","धड़कन","दिल","बीपी","रक्तचाप"]}'),
  ('endocrinology', '{"en":"Diabetes & Endocrinology","te":"మధుమేహం & ఎండోక్రినాలజీ","hi":"मधुमेह और एंडोक्राइनोलॉजी"}',
   '{"en":["sugar","diabetes","thyroid","weight gain","excess thirst"],"te":["షుగర్","మధుమేహం","థైరాయిడ్","బరువు పెరగడం"],"hi":["शुगर","मधुमेह","थायराइड","वज़न बढ़ना"]}'),
  ('orthopaedics', '{"en":"Orthopaedics","te":"ఆర్థోపెడిక్స్","hi":"हड्डी रोग"}',
   '{"en":["knee pain","back pain","joint pain","fracture","fall","neck pain","shoulder pain"],"te":["మోకాలి నొప్పి","నడుము నొప్పి","కీళ్ల నొప్పులు","ఎముక విరగడం","మెడ నొప్పి"],"hi":["घुटने का दर्द","कमर दर्द","जोड़ों का दर्द","फ्रैक्चर","गर्दन दर्द"]}'),
  ('dermatology', '{"en":"Dermatology","te":"చర్మ వ్యాధులు","hi":"त्वचा रोग"}',
   '{"en":["rash","itching","skin","acne","hair fall"],"te":["దద్దుర్లు","దురద","చర్మం","మొటిమలు","జుట్టు రాలడం"],"hi":["दाने","खुजली","त्वचा","मुंहासे","बाल झड़ना"]}'),
  ('paediatrics', '{"en":"Paediatrics","te":"పిల్లల వైద్యం","hi":"बाल रोग"}',
   '{"en":["child","baby","kid","vaccination"],"te":["పిల్లలు","శిశువు","టీకా"],"hi":["बच्चा","शिशु","टीका"]}'),
  ('gynaecology', '{"en":"Gynaecology","te":"స్త్రీ వైద్యం","hi":"स्त्री रोग"}',
   '{"en":["periods","pregnancy","pcos","menstrual"],"te":["నెలసరి","గర్భం","పీసీఓఎస్"],"hi":["माहवारी","गर्भावस्था","पीसीओएस"]}'),
  ('ent', '{"en":"ENT","te":"చెవి ముక్కు గొంతు","hi":"नाक कान गला"}',
   '{"en":["ear pain","sore throat","sinus","hearing","tonsils"],"te":["చెవి నొప్పి","గొంతు నొప్పి","సైనస్","వినికిడి"],"hi":["कान दर्द","गले में खराश","साइनस","सुनाई"]}'),
  ('ophthalmology', '{"en":"Eye care","te":"కంటి వైద్యం","hi":"नेत्र रोग"}',
   '{"en":["eye","vision","blurred","red eye","cataract"],"te":["కన్ను","చూపు","మసక","కంటి ఎరుపు"],"hi":["आंख","नज़र","धुंधला","लाल आंख","मोतियाबिंद"]}'),
  ('psychiatry', '{"en":"Mental health","te":"మానసిక ఆరోగ్యం","hi":"मानसिक स्वास्थ्य"}',
   '{"en":["anxiety","stress","sleep","depression","low mood"],"te":["ఆందోళన","ఒత్తిడి","నిద్ర","డిప్రెషన్"],"hi":["चिंता","तनाव","नींद","अवसाद"]}'),
  ('neurology', '{"en":"Neurology","te":"న్యూరాలజీ","hi":"तंत्रिका रोग"}',
   '{"en":["dizziness","numbness","seizure","migraine","memory"],"te":["తల తిరగడం","తిమ్మిర్లు","ఫిట్స్","మైగ్రేన్","జ్ఞాపకశక్తి"],"hi":["चक्कर","सुन्नपन","दौरा","माइग्रेन","याददाश्त"]}'),
  ('pulmonology', '{"en":"Lungs & breathing","te":"ఊపిరితిత్తులు","hi":"फेफड़े और सांस"}',
   '{"en":["breathing","asthma","wheezing","long cough"],"te":["ఊపిరి","ఆస్తమా","ఆయాసం"],"hi":["सांस","अस्थमा","घरघराहट"]}'),
  ('gastroenterology', '{"en":"Stomach & digestion","te":"జీర్ణకోశ వ్యాధులు","hi":"पेट और पाचन"}',
   '{"en":["stomach pain","acidity","gas","constipation","indigestion"],"te":["కడుపు నొప్పి","ఎసిడిటీ","గ్యాస్","మలబద్ధకం"],"hi":["पेट दर्द","एसिडिटी","गैस","कब्ज़","अपच"]}'),
  ('urology', '{"en":"Urology","te":"మూత్ర వ్యాధులు","hi":"मूत्र रोग"}',
   '{"en":["urine","burning urination","kidney stone","prostate"],"te":["మూత్రం","మంట","కిడ్నీ రాయి"],"hi":["पेशाब","जलन","पथरी","प्रोस्टेट"]}')
on conflict (code) do nothing;
