const cards = ['A', 'B', 'C', 'D', 'E', 'F'];
const game = document.getElementById('game');
let flippedCards = [];
let lockBoard = false;

function createCard(card) {
  let div = document.createElement('div');
  div.classList.add('card');
  div.dataset.card = card;
  div.innerHTML = card;
  game.appendChild(div);

  div.addEventListener('click', function () {
    if (lockBoard) return;
    if (this === flippedCards[0]) return;

    this.classList.add('flipped');

    if (flippedCards.length === 0) {
      flippedCards[0] = this;
      return;
    } else {
      lockBoard = true;
      flippedCards[1] = this;

      if (flippedCards[0].dataset.card === flippedCards[1].dataset.card) {
        flippedCards = [];
        lockBoard = false;
      } else {
        setTimeout(() => {
          flippedCards.forEach(card => card.classList.remove('flipped'));
          flippedCards = [];
          lockBoard = false;
        }, 1000);
      }
    }
  });
}

cards.forEach(card => createCard(card));
cards.forEach(card => createCard(card));
