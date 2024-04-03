import React, {useState, useMemo, useEffect, useRef} from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
import styled from 'styled-components';
import BibleBookChooser from './components/bible/BibleBookChooser';
import BibleVerse from './components/bible/BibleVerse';
import {getBookName, getShortName, getTranslationName, translations} from './library/translations.js';

import summaries from './assets/summaries.json';
import book_summaries from './assets/book_summaries.json';
import BookSummary from "./components/bible/BookSummary.jsx";
import ChapterSummary from "./components/bible/ChapterSummary.jsx";
import {MaxChapter, TRANSLATIONS} from "./components/bible/Translations.js";
import BibleName from "./components/bible/BibleName.jsx";

const NavigationButtons = styled.div`
    display: none; // Default to hidden

    @media (max-width: 768px) {
        display: flex;
        flex-direction: column; // Stack elements vertically
        align-items: center; // Center-align the content
        justify-content: space-between;
        padding: 10px;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background-color: #f0f0f0; // A light background color for visibility
        border-top: 1px solid #ccc; // Add a border top for some separation
        z-index: 100; // Ensure it's above other content
    }
`;

const BookChapterTitle = styled.div`
  font-size: 16px; // Adjust size as needed
  margin-bottom: 10px; // Spacing between title and buttons
  text-align: center; // Ensure text is centered
`;

const NavButton = styled.button`
  padding: 10px 20px;
  background-color: #007bff; // Example blue color
  color: white;
  border: none;
  border-radius: 5px;

  &:disabled {
    background-color: #cccccc;
  }
`;

const Column = styled.div`
    overflow-y: auto;
    @media (min-width: 768px) {
        max-height: 100vh;
    }
`;

const Grid = styled.div`
    display: grid;
    grid-template-columns: 1fr 4fr 1fr;
    gap: 20px;
    width: 100%;
    min-height: 100vh;

    @media (max-width: 768px) {
        gap: 10px;
        grid-template-columns: 1fr;
    }
`;

const VerseGrid = styled.div`
    display: grid;
    grid-template-columns: ${(p) => p.translations.map(() => '1fr').join(' ')};

    @media (max-width: 768px) {
        grid-template-columns: 1fr;
    }
`;

const CenteredContent = styled.div`
    margin: 0 auto;
    padding-bottom: 80px; // Adjust based on the height of your navigation bar

    @media (max-width: 768px) {
        max-width: 100%;
    }
`;

const Dashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const bookSummaryRef = useRef(null);


    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth', // For a smooth scrolling effect
        });
    };

    const handlePrevChapter = () => {
        if (selectedChapter > 1) {
            setSelectedChapter(selectedChapter - 1);
            scrollToBookSummary();
        }
    };

    const handleNextChapter = () => {
        if (selectedChapter < 40) { // Assuming `maxChapters` tracks the total number of chapters
            setSelectedChapter(selectedChapter + 1);
            scrollToBookSummary();
        }
    };

// Helper function to get initial values from URL parameters
    const getInitialValues = () => {
        const searchParams = new URLSearchParams(location.search);
        const bookId = parseInt(searchParams.get('book'), 10);
        const chapter = parseInt(searchParams.get('chapter'), 10);
        const verseId = parseInt(searchParams.get('verseId'), 10);
        const translationsParam = searchParams.get('translations');

        // Correctly split 'translations' URL parameter into an array
        const selectedTranslations = translationsParam ? translationsParam.split(',').map(t => ({
            value: t.trim(),
            label: getShortName(t.trim()) // Ensure to trim to remove any accidental whitespace
        })) : [{value: 'osnb1', label: getShortName('osnb1')}];

        const firstTranslation = selectedTranslations[0]?.value || Object.keys(translations)[0];
        const bookLabel = bookId ? getBookName(firstTranslation, bookId) : "Matteus' evangelium";

        return {
            selectedBook: bookId ? {value: bookId, label: bookLabel} : {value: 40, label: bookLabel},
            selectedChapter: chapter || 1,
            selectedVerse: verseId || null,
            selectedTranslations,
        };
    };

    // Initialize state with values from URL or defaults
    const {
        selectedBook: initialBook,
        selectedChapter: initialChapter,
        selectedTranslations: initialTranslations,
        selectedVerse: initialVerse
    } = getInitialValues();
    const [selectedBook, setSelectedBook] = useState(initialBook);
    const [selectedChapter, setSelectedChapter] = useState(initialChapter);
    const [selectedTranslations, setSelectedTranslations] = useState(initialTranslations);
    const [selectedVerse, setSelectedVerse] = useState(initialVerse);

    const maxChapter = useMemo(() => {
        return MaxChapter(selectedTranslations[0], selectedBook)
    }, [selectedTranslations, selectedBook, selectedChapter])

    const verseRefs = useRef({});

    useEffect(() => {
        if (selectedVerse && verseRefs.current[selectedVerse]) {
            verseRefs.current[selectedVerse].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [selectedVerse]);

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const book = searchParams.get('book');
        const chapter = searchParams.get('chapter');
        const translationsParam = searchParams.get('translations');
        const verseId = searchParams.get('verseId')

        if (book && chapter && translationsParam) {
            // Split the translations parameter into an array of translation codes
            const translationCodes = translationsParam.split(",");

            // Map over each code to create the expected object structure for each translation
            const translationsObjects = translationCodes.map(code => ({
                value: code,
                label: getTranslationName(code.trim()) // Assuming getTranslationName is a function that returns the name based on code
            }));

            setSelectedBook({value: parseInt(book), label: getBookName(translationCodes[0].trim(), parseInt(book))}); // Use the first translation code to get the book name
            setSelectedChapter(parseInt(chapter));
            setSelectedTranslations(translationsObjects);
        }
        if (verseId)
            setSelectedVerse(+verseId)
    }, [location.search]); // This dependency ensures the effect runs whenever the search part of the URL changes

    function normalizeQueryString(queryString) {
        // Parse the query string into a key-value map
        const params = new URLSearchParams(queryString);

        // Sort the parameters by key
        const sortedParams = new URLSearchParams();
        Array.from(params.keys()).sort().forEach(key => {
            sortedParams.append(key, params.get(key));
        });

        // Return the normalized, sorted query string
        return sortedParams.toString();
    }

    const updateUrlParams = (book, chapter, translations, verseId) => {
        const searchParams = new URLSearchParams();
        searchParams.set('book', book);
        searchParams.set('chapter', chapter);
        searchParams.set('translations', translations.map(t => t.value).join(',')); // Assumes translations is an array
        console.log("Dashboard navigating", searchParams.toString())
        if (verseId) searchParams.set('verseId', verseId);
        const currentUrl = location.search;
        if (normalizeQueryString(currentUrl) !== normalizeQueryString(`?${searchParams.toString()}`)) {
            console.log("Navigating", currentUrl, `?${searchParams.toString()}`)
            navigate(`?${searchParams.toString()}`, {replace: false});
        }
    };

    useEffect(() => {
        updateUrlParams(selectedBook.value, selectedChapter, selectedTranslations, selectedVerse);
    }, [selectedBook, selectedChapter, selectedTranslations, selectedVerse]);

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
        selectedTranslations.forEach(({value: translationValue}) => {
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
        setSelectedVerse(null)
        setSelectedChapter(chapter);
    };

    const handleTranslationChange = (translation) => {
        setSelectedTranslations(translation);
    };

    const scrollToBookSummary = () => {
        if (bookSummaryRef.current) {
            bookSummaryRef.current.scrollIntoView({  });
        }
    };

    return (
        <Grid>
            <Column>
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
                                ref={bookSummaryRef}
                                summary={book_summary}
                                bookName={getBookName(selectedTranslations[0].value, selectedBook.value)}
                            />
                        )}
                        {summary && (
                            <ChapterSummary summary={summary}/>
                        )}
                        {selectedTranslations.length > 0 && selectedBook && (
                            <VerseGrid translations={selectedTranslations}>
                                {selectedTranslations.map((translation, index) => (
                                <BibleName
                                    key={index}
                                    translation={translation}
                                />
                                ))}
                                {Array.from({length: maxVerseCount}, (_, i) => i + 1).map(verseId =>
                                    <React.Fragment key={`verse-${verseId}`}>
                                        {selectedTranslations.map(({value: translationValue}) => {
                                            const verse = versesByTranslationAndVerseId[translationValue] ? versesByTranslationAndVerseId[translationValue][verseId] : null;
                                            return verse ? (
                                                <div key={`${translationValue}-${verseId}`} ref={el => verseRefs.current[verseId] = el}>
                                                    <BibleVerse
                                                        key={`${translationValue}-${selectedChapter}-${verseId}`}
                                                        verse={verse}
                                                        verseNumber={true}
                                                    />
                                                </div>
                                            ) : (
                                                <div key={`${translationValue}-${verseId}`} style={{textAlign: 'center', padding: '10px'}}>
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
                <NavigationButtons>
                    <BookChapterTitle>
                        {getBookName(selectedTranslations[0]?.value, selectedBook.value)} {selectedChapter}
                    </BookChapterTitle>
                    <div style={{display: 'flex', justifyContent: 'space-between', width: '100%'}}> {/* Ensure buttons are horizontally aligned */}
                        <NavButton onClick={handlePrevChapter} disabled={selectedChapter === 1}>
                            Forrige
                        </NavButton>
                        <NavButton onClick={scrollToTop}>
                            Toppen
                        </NavButton>
                        <NavButton onClick={handleNextChapter} disabled={selectedChapter === maxChapter}>
                            Neste
                        </NavButton>
                    </div>
                </NavigationButtons>
            </Column>
        </Grid>
    );
};

export default Dashboard;
