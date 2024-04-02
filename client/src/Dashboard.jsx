import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import BibleBookChooser from './components/bible/BibleBookChooser';
import BibleVerse from './components/bible/BibleVerse';
import {getBookName, getShortName, getTranslationName, translations} from './library/translations.js';

import dnb30 from './bibles/dnb30.json';
import osnb1 from './bibles/osnb1.json';
import sblgnt from './bibles/sblgnt.json';
import tanach from './bibles/tanach.json';

import summaries from './assets/summaries.json';
import book_summaries from './assets/book_summaries.json';
import BookSummary from "./components/bible/BookSummary.jsx";
import ChapterSummary from "./components/bible/ChapterSummary.jsx";

const TRANSLATIONS = {
    'dnb30': dnb30,
    'osnb1': osnb1,
    'sblgnt': sblgnt,
    'tanach': tanach
};

const Column = styled.div`
    overflow-y: auto;
    max-height: 100vh;
`;

const Grid = styled.div`
    display: grid;
    grid-template-columns: 1fr 4fr 1fr;
    gap: 20px;
    width: 100%;
    min-height: 100vh;

    @media (max-width: 768px) {
        grid-template-columns: 1fr;
    }
`;

const VerseGrid = styled.div`
    display: grid;
    grid-template-columns: ${(p) => p.translations.map(() => '1fr').join(' ')};
    gap: 20px;

    @media (max-width: 768px) {
        grid-template-columns: 1fr;
    }
`;

const CenteredContent = styled.div`
    margin: 0 auto;

    @media (max-width: 768px) {
        max-width: 90%;
    }
`;

const Dashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();

// Helper function to get initial values from URL parameters
    const getInitialValues = () => {
        const searchParams = new URLSearchParams(location.search);
        const bookId = parseInt(searchParams.get('book'), 10);
        const chapter = parseInt(searchParams.get('chapter'), 10);
        const translationsParam = searchParams.get('translations');

        // Correctly split 'translations' URL parameter into an array
        const selectedTranslations = translationsParam ? translationsParam.split(',').map(t => ({
            value: t.trim(),
            label: getShortName(t.trim()) // Ensure to trim to remove any accidental whitespace
        })) : [{ value: 'osnb1', label: getShortName('osnb1') }];

        const firstTranslation = selectedTranslations[0]?.value || Object.keys(translations)[0];
        const bookLabel = bookId ? getBookName(firstTranslation, bookId) : "Matteus' evangelium";

        return {
            selectedBook: bookId ? { value: bookId, label: bookLabel } : { value: 40, label: bookLabel },
            selectedChapter: chapter || 1,
            selectedTranslations,
        };
    };

    // Initialize state with values from URL or defaults
    const { selectedBook: initialBook, selectedChapter: initialChapter, selectedTranslations: initialTranslations } = getInitialValues();
    const [selectedBook, setSelectedBook] = useState(initialBook);
    const [selectedChapter, setSelectedChapter] = useState(initialChapter);
    const [selectedTranslations, setSelectedTranslations] = useState(initialTranslations);

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const book = searchParams.get('book');
        const chapter = searchParams.get('chapter');
        const translationsParam = searchParams.get('translations');

        if (book && chapter && translationsParam) {
            // Split the translations parameter into an array of translation codes
            const translationCodes = translationsParam.split(",");

            // Map over each code to create the expected object structure for each translation
            const translationsObjects = translationCodes.map(code => ({
                value: code,
                label: getTranslationName(code.trim()) // Assuming getTranslationName is a function that returns the name based on code
            }));

            setSelectedBook({ value: parseInt(book), label: getBookName(translationCodes[0].trim(), parseInt(book)) }); // Use the first translation code to get the book name
            setSelectedChapter(parseInt(chapter));
            setSelectedTranslations(translationsObjects);
            console.log(translationsObjects)
        }
    }, [location.search]); // This dependency ensures the effect runs whenever the search part of the URL changes

    const updateUrlParams = (book, chapter, translations) => {
        const searchParams = new URLSearchParams();
        searchParams.set('book', book);
        searchParams.set('chapter', chapter);
        searchParams.set('translations', translations.map(t => t.value).join(',')); // Assumes translations is an array
        navigate(`?${searchParams.toString()}`);
    };

    useEffect(() => {
        updateUrlParams(selectedBook.value, selectedChapter, selectedTranslations);
    }, [selectedBook, selectedChapter, selectedTranslations]);

    const combinedVerses = useMemo(() => {
        const verseSet = new Set();
        selectedTranslations.forEach(translation => {
            // Safely access TRANSLATIONS[translation.value] and proceed only if it's not undefined
            const translationData = TRANSLATIONS[translation.value];
            if (!translationData) {
                console.warn(`No data found for translation: ${translation.value}`);
                return; // Skip this iteration if the translation data is missing
            }

            // Assuming the structure of each translationData matches your expected format
            translationData
                .filter(verse => +verse.bookId === +selectedBook.value && +verse.chapterId === +selectedChapter)
                .forEach(verse => verseSet.add(`${verse.verseId}-${translation.value}`));
        });
        return Array.from(verseSet);
    }, [selectedBook, selectedChapter, selectedTranslations]);

    const versesByTranslationAndVerseId = useMemo(() => {
        const verses = {};
        selectedTranslations.forEach(({ value: translationValue }) => {
            // Initialize storage for each translation
            verses[translationValue] = {};

            // Go through each verse in the translation
            TRANSLATIONS[translationValue].forEach(verse => {
                if (verse.bookId === selectedBook.value && verse.chapterId === selectedChapter) {
                    // Store the verse by its verseId for easy access
                    verses[translationValue][verse.verseId] = verse;
                }
            });
        });
        return verses;
    }, [selectedBook, selectedChapter, selectedTranslations]);

    const summary = useMemo(() => {
        return summaries.find(summary => +summary.bookId === +selectedBook.value && +summary.chapterId === +selectedChapter) || null;
    }, [selectedBook, selectedChapter]);

    const book_summary = useMemo(() => {
        return book_summaries.find(summary => +summary.bookId === +selectedBook.value) || null;
    }, [selectedBook]);

    const maxVerseCount = useMemo(() => {
        let maxCount = 0;
        selectedTranslations.forEach(translation => {
            const verses = TRANSLATIONS[translation.value].filter(verse => +verse.bookId === +selectedBook.value && +verse.chapterId === +selectedChapter);
            const currentMaxVerseId = Math.max(...verses.map(verse => verse.verseId));
            maxCount = Math.max(maxCount, currentMaxVerseId);
        });
        return maxCount;
    }, [selectedBook, selectedChapter, selectedTranslations]);

    const handleBookChange = (book) => {
        setSelectedBook(book);
        setSelectedChapter(1);
    };

    const handleChapterChange = (chapter) => {
        setSelectedChapter(chapter);
    };

    const handleTranslationChange = (translation) => {
        setSelectedTranslations(translation);
    };

    return (
        <Grid>
            <Column>
                <h1>Velg</h1>
                <BibleBookChooser
                    translations={translations}
                    onSelectBook={handleBookChange}
                    onSelectTranslation={handleTranslationChange}
                    onSelectChapter={handleChapterChange}
                    selectedTranslation={selectedTranslations}
                    selectedChapter={selectedChapter}
                    selectedBook={selectedBook}
                />
            </Column>
            <Column>
                {selectedTranslations.length > 0 &&
                    <CenteredContent>
                        {book_summary && (
                            <BookSummary
                                summary={book_summary}
                                bookName={getBookName(selectedTranslations[0].value, selectedBook.value)}
                            />
                        )}
                        {summary && (
                            <ChapterSummary summary={summary} />
                        )}
                        {selectedTranslations.length > 0 && selectedBook && (
                            <VerseGrid translations={selectedTranslations}>
                                {selectedTranslations.map(translation => <div key={translation.value}>{getTranslationName(translation.value)}</div>)}
                                {Array.from({ length: maxVerseCount }, (_, i) => i + 1).map(verseId =>
                                    <React.Fragment key={`verse-${verseId}`}>
                                        {selectedTranslations.map(({ value: translationValue }) => {
                                            const verse = versesByTranslationAndVerseId[translationValue] ? versesByTranslationAndVerseId[translationValue][verseId] : null;
                                            return verse ? (
                                                <BibleVerse
                                                    key={`${translationValue}-${selectedChapter}-${verseId}`}
                                                    verse={verse}
                                                    verseNumber={true}
                                                />
                                            ) : (
                                                <div key={`${translationValue}-${verseId}`} style={{ textAlign: 'center', padding: '10px' }}>
                                                    -
                                                </div>
                                            );
                                        })}
                                    </React.Fragment>
                                )}
                            </VerseGrid>
                        )}
                    </CenteredContent>
                }
            </Column>
        </Grid>
    );
};

export default Dashboard;
