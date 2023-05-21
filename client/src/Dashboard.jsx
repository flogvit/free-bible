import React, {useState, useMemo} from 'react';
import styled from 'styled-components';
import BibleBookChooser from './components/bible/BibleBookChooser';
import BibleVerse from './components/bible/BibleVerse';
import parse from 'html-react-parser';
import {translations} from './library/translations.js'

import dnb30 from './bibles/dnb30.json';
import kjv from './bibles/kjv.json';
import osnb1 from './bibles/osnb1.json';
import word4word from './assets/word4word.json'
import references from './assets/references.json'
import summaries from './assets/summaries.json'
import book_summaries from './assets/book_summaries.json'

const TRANSLATIONS = {
    'kjv': kjv,
    'dnb30': dnb30,
    'osnb1': osnb1
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 4fr 1fr;
  gap: 20px;
  width: 100%;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const VerseGrid = styled.div`
  display: grid;
  grid-template-columns: ${(p) => p.translations.map(t => ' 1fr')};
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
    const [selectedBook, setSelectedBook] = useState({value: 1, label: "1. Mosebok"});
    const [selectedChapter, setSelectedChapter] = useState(1);
    const [selectedTranslations, setSelectedTranslations] = useState([{value: 'osnb1', label: "OSNB"}, {value: 'dnb30', label: "DNB30"}, {value: 'kjv', label: 'KJV'}]);

    const verses = useMemo(() => {
        const result = [];
        selectedTranslations.forEach(translation => {
            result.push(TRANSLATIONS[translation.value].filter(verse => +verse.bookId === +selectedBook.value && +verse.chapterId === +selectedChapter))
        })
        return result;
    }, [selectedBook, selectedChapter, selectedTranslations])

    const summary = useMemo(() => {
        return summaries.find(summary => +summary.bookId===+selectedBook.value && +summary.chapterId === +selectedChapter) || null
    }, [selectedBook, selectedChapter])

    const book_summary = useMemo(() => {
        return book_summaries.find(summary => +summary.bookId===+selectedBook.value) || null;
    }, [selectedBook])

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
            <div>
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
            </div>
            <CenteredContent>
                <h1>Kapittel {selectedChapter}</h1>
                {selectedTranslations.length > 0 && selectedBook && (
                    <VerseGrid translations={selectedTranslations}>
                        {selectedTranslations.map(translation => <div key={translation.value}>{translation.value}</div>)}
                        {verses && verses[0].map((verse, idx) =>
                            <React.Fragment key={`A-${verse.bookId}-${verse.chapterId}-${verse.verseId}`}>
                                <BibleVerse
                                    verse={verse}
                                    verseNumber={true}
                                ></BibleVerse>
                                {verses.slice(1).map(translation => {
                                    const verse = translation[idx];
                                    return <React.Fragment key={`${verse.bible}-${verse.bookId}-${verse.chapterId}-${verse.verseId}`}>
                                        <BibleVerse
                                            verse={verse}
                                            verseNumber={true}
                                        ></BibleVerse>
                                    </React.Fragment>
                                })}
                            </React.Fragment>
                        )}
                    </VerseGrid>
                )}
            </CenteredContent>
            <div>
                <h1>Hjelpemidler</h1>
                <i>Denne bolken er ikke laget ennå, men viser hvordan du kan få opp informasjon om hvert kapittel og vers</i>
                <h2>Sammendrag</h2>
                {summary && parse(summary.text)}
                <h2>{translations[selectedTranslations[0].value].books.find(book => book.id===+selectedBook.value).name}</h2>
                {book_summary && parse(book_summary.text)}
                <h2>1.Mosebok 1,1</h2>
                <div>
                {parse(word4word[0].text)}
                </div>
                <p></p>
                <h2>Referanser</h2>
                <div>
                    {parse(references[0].text)}
                </div>
            </div>
        </Grid>
    );
};

export default Dashboard;