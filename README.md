# Free Bibles
This project strive to give free versions of the Bible in as many languages as possible.

It uses GPT-4 or other LLMs to translate from already free versions of the Bible.

## Second goal
The second goal is to create free software which can be run online or on your own computer for Bible studies.

## Statuses

NOT STARTED  
CHECKING  
FINISHED

## Translations
OSNB1 - Norwegian Bokmål, first version - Status: CHECKING  
OSNN1 - Norwegian Nynorsk, first version - Status: NOT STARTED

## Summary
All languages will get a summary for each chapter.

NB - Norwegian Bokmål - Status: GENERATING

## Word 4 word
All languages will get a word for word translation from the original language for each verse

NB - Norwegian Bokmål - Status: NOT STARTED

## References
All languages will get a reference list for each verse

NB - Norwegian Bokmål - Status: NOT STARTED

## Variations

The project will try to create both very easy to read and word for word translations when we are finished with the main translation.

## Prompt to create translations
This is the prompt used to create the Bible in norwegian, bokmål:

```
Use your understanding of vulgata, KJV, WEB and ASV to make a translation of all verses in ${bibleRef} with an easy to read language in norwegian, bokmål.
Adjust for previous verses so the sentences does not start with the same words and feels fluent.
When you are finished with the whole chapter, write FINISHED
I want you to answer in the format, and only answer in this format, no other text or questions:
${bookNr}:${chapter}:<verse>:<text>
```

## GTP-4 known Bibles
This is the answer GTP-4 gives when asked which Bibles is knowns:

As an AI developed by OpenAI, I don't hold any translations, but I can generate translations based on data I've been trained on. Here are some of the translations and versions of the Bible that I've been trained on up until my knowledge cutoff in September 2021:

King James Version (KJV)
New International Version (NIV)
English Standard Version (ESV)
New King James Version (NKJV)
New American Standard Bible (NASB)
Revised Standard Version (RSV)
New Revised Standard Version (NRSV)
Douay-Rheims Bible
World English Bible (WEB)
American Standard Version (ASV)
Young's Literal Translation (YLT)
Darby Translation
Webster's Bible Translation
I should note that while I can provide translations based on these versions, the translations won't always be perfect because translating languages is a complex task.

For specific languages, I can attempt to translate into over 100 languages including Spanish, French, German, Italian, Dutch, Portuguese, Russian, Arabic, Chinese, Japanese, Korean, and many more. However, the accuracy of translations can vary depending on the specific language and the complexity of the text. Please note that I do not have access to modern specific Bible translations in languages other than English. I can only generate approximate translations based on my training data.

For copyright-free and open-license translations, the King James Version (KJV), World English Bible (WEB), and American Standard Version (ASV) are commonly used. Always verify the copyright status in your specific context if that is a concern.

## Encyclopedias
The project will also generate encyclopedias like verse word for word, cross references and summaries.

## Preview
It is possible to view the current state at: https://menneske.no/freebible/

## Support

You are free to dontate to the project if you want. Each translation costs about $200, and the encyclopedias costs a lot more.

## People

Founder of the project: Vegard Hanssen, email: Vegard.Hanssen@menneske.no

## Copyright 2023 Free Bible

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.